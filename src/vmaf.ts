import fs from 'fs'
import Jimp from 'jimp'
import os from 'os'
import path from 'path'
import { createScheduler, createWorker, PSM } from 'tesseract.js'

import { logger, runShellCommand } from './utils'

const log = logger('app:vmaf')

// VMAF score methods.
export type IvfFrame = {
  index: number
  position: number
  size: number
}

export type IvfInfo = {
  width: number
  height: number
  frameRate: number
  ptsIndex: number[]
  frames: Map<number, IvfFrame>
}

const chunkedPromiseAll = async <T, R>(
  items: Array<T>,
  f: (v: T, index: number) => Promise<R>,
  chunkSize = 1,
): Promise<R[]> => {
  const results = Array<R>(items.length)
  for (let index = 0; index < items.length; index += chunkSize) {
    await Promise.allSettled(
      items.slice(index, index + chunkSize).map(async (item, i) => {
        results[index + i] = await f(item, index + i)
      }),
    )
  }
  return results
}

export async function parseIvf(
  fpath: string,
  runRecognizer = false,
): Promise<IvfInfo> {
  log.debug(`parseIvf`, { fpath, runRecognizer })

  const fd = await fs.promises.open(fpath, 'r')
  const headerData = new ArrayBuffer(32)
  const headerView = new DataView(headerData)
  const ret = await fd.read(headerView, 0, 32, 0)
  if (ret.bytesRead !== 32) {
    throw new Error('Invalid IVF file')
  }
  const width = headerView.getUint16(12, true)
  const height = headerView.getUint16(14, true)
  const den = headerView.getUint32(16, true)
  const num = headerView.getUint32(20, true)
  const frameRate = den / num

  const frameHeaderView = new DataView(new ArrayBuffer(12))
  let index = 0
  let position = 32
  let bytesRead = 0
  const frames = new Map<number, IvfFrame>()
  do {
    const ret = await fd.read(
      frameHeaderView,
      0,
      frameHeaderView.byteLength,
      position,
    )
    bytesRead = ret.bytesRead
    if (bytesRead !== 12) {
      break
    }
    const size = frameHeaderView.getUint32(0, true)
    const pts = Number(frameHeaderView.getBigUint64(4, true))
    /* if (pts <= ptsIndex[ptsIndex.length - 1]) {
      log.warn(`IVF file ${fpath}: pts ${pts} <= prev ${ptsIndex[ptsIndex.length - 1]}`)
    } */
    if (frames.has(pts)) {
      log.warn(`IVF file ${fpath}: pts ${pts} already present, skipping`)
    } else {
      frames.set(pts, { index, position, size: size + 12 })
      index++
    }
    position += size + 12
  } while (bytesRead === 12)

  if (runRecognizer) {
    const tesseractScheduler = createScheduler()
    const NUM_WORKERS = os.cpus().length
    for (let i = 0; i < NUM_WORKERS; i++) {
      const worker = await createWorker('eng')
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_char_whitelist: '0123456789',
      })
      tesseractScheduler.addWorker(worker)
    }

    const recognizeFrame = async (pts: number, index: number) => {
      const frame = frames.get(pts)
      if (!frame) {
        log.warn(`IVF file ${fpath}: pts ${pts} not found, skipping`)
        frames.delete(pts)
        return
      }
      const { size, position } = frame

      const frameView = new DataView(new ArrayBuffer(size))
      await fd.read(frameView, 0, size, position + 12)

      let image = await Jimp.read(
        Buffer.from(frameView.buffer, 0, frameView.byteLength),
      )
      image = image.crop(0, 0, width / 2, Math.ceil(height / 18) + 6)
      const ret = await tesseractScheduler.addJob(
        'recognize',
        await image.getBufferAsync(Jimp.MIME_BMP),
      )
      const { data } = ret
      const recognizedTime = parseInt(data.text.trim() || '0')
      log.debug(
        `recognize pts=${index}/${
          frames.size
        } text=${data.text.trim()} confidence=${
          data.confidence
        } recognizedTime=${recognizedTime}`,
      )
      if (data.confidence < 75 || !recognizedTime) {
        log.warn(
          `recognize pts=${index}/${
            frames.size
          } failed: text=${data.text.trim()} confidence=${
            data.confidence
          } recognizedTime=${recognizedTime}`,
        )
        frames.delete(pts)
        return
      }
      const recognizedPts = Math.round((frameRate * recognizedTime) / 1000)
      if (recognizedPts !== pts) {
        frames.delete(pts)
        frames.set(recognizedPts, frame)
      }
    }

    log.info(`parseIvf ${fpath} running recognizer...`)
    await chunkedPromiseAll(
      Array.from(frames.keys()),
      recognizeFrame,
      NUM_WORKERS,
    )
    log.info(`parseIvf ${fpath} running recognizer done`)

    await tesseractScheduler.terminate()
  }

  const ptsIndex = Array.from(frames.keys()).sort((a, b) => a - b)

  await fd.close()
  return { width, height, frameRate, ptsIndex, frames }
}

export async function fixIvfFrames(fpath: string) {
  const fixedPath = fpath.replace('.ivf', '.fixed.ivf')
  if (fs.existsSync(fixedPath)) {
    const { width, height, frameRate, ptsIndex } = await parseIvf(fixedPath)
    return { width, height, frameRate, startPts: ptsIndex[0] }
  }

  const { width, height, frameRate, frames, ptsIndex } = await parseIvf(
    fpath,
    true,
  )
  if (!ptsIndex.length) {
    throw new Error(`IVF file ${fpath}: no frames found`)
  }
  log.debug(`fixIvfFrames ${fpath}`, { width, height, frameRate })
  const fd = await fs.promises.open(fpath, 'r')
  const fixedFd = await fs.promises.open(fixedPath, 'w')
  const headerView = new DataView(new ArrayBuffer(32))
  await fd.read(headerView, 0, headerView.byteLength, 0)

  let position = 32
  let writtenFrames = 0
  let startPts = -1
  let previousPts = -1
  let previousFrame: DataView | null = null
  let duplicatedFrames = 0

  for (const pts of ptsIndex) {
    const frame = frames.get(pts)
    if (!frame) {
      log.warn(`IVF file ${fpath}: pts ${pts} not found, skipping`)
      continue
    }

    if (previousFrame && previousPts >= 0 && previousPts < pts - 1) {
      const missing = pts - previousPts - 1
      if (missing > frameRate * 60 * 60) {
        throw new Error(
          `IVF file ${fpath}: too many frames missing: ${missing}`,
        )
      }
      log.debug(
        `IVF file ${fpath}: pts ${pts} missing ${missing} frames, copying previous`,
      )
      while (pts - previousPts - 1 > 0) {
        previousPts++
        previousFrame.setBigUint64(4, BigInt(previousPts), true)
        await fixedFd.write(
          new Uint8Array(previousFrame.buffer),
          0,
          previousFrame.byteLength,
          position,
        )
        position += previousFrame.byteLength
        writtenFrames++
        duplicatedFrames++
      }
    }

    const frameView = new DataView(new ArrayBuffer(frame.size))
    await fd.read(frameView, 0, frame.size, frame.position)
    frameView.setBigUint64(4, BigInt(pts), true)
    await fixedFd.write(
      new Uint8Array(frameView.buffer),
      0,
      frameView.byteLength,
      position,
    )
    position += frameView.byteLength
    writtenFrames++
    if (startPts < 0) {
      startPts = pts
    }
    previousPts = pts
    previousFrame = frameView
  }

  headerView.setUint32(24, writtenFrames, true)
  await fixedFd.write(
    new Uint8Array(headerView.buffer),
    0,
    headerView.byteLength,
    0,
  )

  previousFrame = null
  await fd.close()
  await fixedFd.close()

  log.info(
    `IVF file ${fpath}: frames written: ${writtenFrames} duplicated: ${duplicatedFrames}`,
  )

  return { width, height, frameRate, startPts }
}

async function alignVideos(referencePath: string, degradedPath: string) {
  if (!referencePath.endsWith('.ivf') || !degradedPath.endsWith('.ivf')) {
    throw new Error('Only IVF files are supported')
  }

  log.debug(
    `alignVideos referencePath: ${referencePath} degradedPath: ${degradedPath}`,
  )
  const {
    width,
    height,
    frameRate,
    startPts: referenceStartPts,
  } = await fixIvfFrames(referencePath)
  const { startPts: degradedFirstPts } = await fixIvfFrames(degradedPath)

  const ptsDiff = degradedFirstPts - referenceStartPts
  return { width, height, frameRate, ptsDiff }
}

async function runVmaf(
  referencePath: string,
  degradedPath: string,
  preview: boolean,
) {
  log.info('runVmaf', { referencePath, degradedPath, preview })
  const comparisonPath =
    referencePath.replace(/\.[^.]+$/, '_compared-with_') +
    path.basename(degradedPath.replace(/\.[^.]+$/, ''))
  const vmafLogPath = comparisonPath + '.vmaf.json'
  const cpus = os.cpus().length

  const { width, height, frameRate, ptsDiff } = await alignVideos(
    referencePath,
    degradedPath,
  )

  const degradedPathFixed = degradedPath.replace('.ivf', '.fixed.ivf')
  const referencePathFixed = referencePath.replace('.ivf', '.fixed.ivf')

  const cmd = preview
    ? `ffmpeg -loglevel warning -y -threads ${cpus} \
-i ${degradedPathFixed} \
-ss ${ptsDiff / frameRate} -i ${referencePathFixed} \
-filter_complex "\
[0:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame,fps=fps=${frameRate},split[deg1][deg2];\
[1:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame,fps=fps=${frameRate},split[ref1][ref2];\
[deg1][ref1]libvmaf=model='path=/usr/share/model/vmaf_v0.6.1.json':log_fmt=json:log_path=${vmafLogPath}:n_subsample=1:n_threads=${cpus}:shortest=1[vmaf];\
[ref2][deg2]hstack=shortest=1[stacked]" \
-map [vmaf] -f null - \
-map [stacked] -c:v libx264 -crf 20 -f mp4 ${comparisonPath + '.mp4'} \
`
    : `ffmpeg -loglevel warning -y -threads ${cpus} \
-i ${degradedPathFixed} \
-ss ${ptsDiff / frameRate} -i ${referencePathFixed} \
-filter_complex "\
[0:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame,fps=fps=${frameRate}[deg];\
[1:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame,fps=fps=${frameRate}[ref];\
[deg][ref]libvmaf=model='path=/usr/share/model/vmaf_v0.6.1.json':log_fmt=json:log_path=${vmafLogPath}:n_subsample=1:n_threads=${cpus}:shortest=1[vmaf]" \
-map [vmaf] -f null - \
`

  log.debug('runVmaf', cmd)
  const { stdout, stderr } = await runShellCommand(cmd)
  const vmafLog = JSON.parse(await fs.promises.readFile(vmafLogPath, 'utf-8'))
  log.debug('runVmaf', {
    stdout,
    stderr,
    vmafLog: vmafLog['pooled_metrics']['vmaf'],
  })
  log.info('VMAF metrics:', vmafLog['pooled_metrics']['vmaf'])

  const plotlyPath = comparisonPath + '.plotly'
  const title = path.basename(comparisonPath)
  const plotlyData = {
    data: [
      {
        uid: 'id',
        fill: 'none',
        mode: 'lines',
        name: 'VMAF score',
        type: 'scatter',
        x: vmafLog.frames.map(({ frameNum }: { frameNum: number }) => frameNum),
        y: vmafLog.frames.map(
          ({ metrics }: { metrics: { vmaf: number } }) => metrics.vmaf,
        ),
      },
    ],
    layout: {
      title,
      width: 1280,
      height: 720,
      xaxis: {
        type: 'linear',
        range: [0, vmafLog.frames.length],
        dtick: frameRate,
        title: 'Frame',
        showgrid: true,
        autorange: false,
      },
      yaxis: {
        type: 'linear',
        range: [0, 100],
        title: 'Score',
        showgrid: true,
        autorange: false,
      },
      autosize: false,
    },
    frames: [],
  }
  await fs.promises.writeFile(plotlyPath, JSON.stringify(plotlyData))
}

type VmafConfig = {
  vmafReferencePath: string
  vmafDegradedPaths: string
  vmafPreview: boolean
}

export async function calculateVmafScore(config: VmafConfig): Promise<void> {
  const { vmafReferencePath, vmafDegradedPaths, vmafPreview } = config
  if (!fs.existsSync(config.vmafReferencePath)) {
    throw new Error(
      `VMAF reference file ${config.vmafReferencePath} does not exist`,
    )
  }
  const vmafDegradedPathsSplit = vmafDegradedPaths.split(',')
  vmafDegradedPathsSplit.forEach(path => {
    if (!fs.existsSync(path)) {
      throw new Error(`VMAF degraded file ${path} does not exist`)
    }
  })

  log.debug(
    ` calculateVmafScore referencePath=${vmafReferencePath} degradedPaths=${vmafDegradedPathsSplit}`,
  )

  for (const degradedPath of vmafDegradedPathsSplit) {
    await runVmaf(vmafReferencePath, degradedPath, vmafPreview)
  }
}
