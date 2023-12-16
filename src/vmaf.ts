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
  f: (v: T) => Promise<R>,
  chunkSize = 1,
): Promise<R[]> => {
  const results = Array<R>(items.length);
  for(let index = 0; index < items.length; index += chunkSize) {
    await Promise.allSettled(items.slice(index, index + chunkSize).map(async (item, i) => {
      results[index + i] = await f(item)
    }))
  }
  return results;
};

export async function parseIvf(
  fpath: string,
  runRecognizer = true,
): Promise<IvfInfo> {
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

    const recognizeFrame = async (pts: number) => {
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
        `recognize pts=${pts}/${
          frames.size
        } text=${data.text.trim()} confidence=${
          data.confidence
        } recognizedTime=${recognizedTime}`,
      )
      if (data.confidence < 90 || !recognizedTime) {
        log.warn(
          `recognize pts=${pts}/${
            frames.size
          } failed: text=${data.text.trim()} confidence=${
            data.confidence
          } recognizedTime=${recognizedTime / 1000}`,
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

    await chunkedPromiseAll(Array.from(frames.keys()), recognizeFrame, NUM_WORKERS)

    await tesseractScheduler.terminate()
  }

  const ptsIndex = Array.from(frames.keys()).sort((a, b) => a - b)

  await fd.close()
  return { width, height, frameRate, ptsIndex, frames }
}

export async function fixIvfFrames(
  fpath: string,
  infos: IvfInfo,
  backup = true,
) {
  const { width, height, frameRate, frames, ptsIndex } = infos
  if (!ptsIndex.length) {
    log.warn(`IVF file ${fpath}: no pts found`)
    return 0
  }
  log.debug(`fixIvfFrames ${fpath}`, { width, height, frameRate })

  const fd = await fs.promises.open(fpath, 'r')
  const fixedPath = fpath.replace('.ivf', '.fixed.ivf')
  const fixedFd = await fs.promises.open(fixedPath, 'w')

  const headerView = new DataView(new ArrayBuffer(32))
  await fd.read(headerView, 0, headerView.byteLength, 0)

  let position = 32
  let writtenFrames = 0
  let startPts = -1
  let previousPts = -1
  let previousFrame: DataView | null = null

  for (const pts of ptsIndex) {
    const frame = frames.get(pts)
    if (!frame) {
      log.warn(`IVF file ${fpath}: pts ${pts} not found, skipping`)
      continue
    }

    if (previousFrame && previousPts >= 0 && previousPts < pts - 1) {
      log.warn(
        `IVF file ${fpath}: pts ${pts} missing ${
          pts - previousPts - 1
        } frames, copying previous`,
      )
      while (previousPts < pts - 1) {
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

  if (backup) {
    await fs.promises.rename(fpath, fpath + '.bk')
  }
  await fs.promises.rename(fixedPath, fpath)

  return startPts
}

async function alignVideos(referencePath: string, degradedPath: string) {
  if (!referencePath.endsWith('.ivf') || !degradedPath.endsWith('.ivf')) {
    throw new Error('Only IVF files are supported')
  }

  log.debug(
    `alignVideos referencePath: ${referencePath} degradedPath: ${degradedPath}`,
  )
  const referenceInfos = await parseIvf(referencePath)
  const referenceStartPts = await fixIvfFrames(referencePath, referenceInfos)

  const { width, height, frameRate } = referenceInfos
  const degradedInfos = await parseIvf(degradedPath)
  const degradedFirstPts = await fixIvfFrames(degradedPath, degradedInfos)

  const ptsDiff = degradedFirstPts - referenceStartPts
  return { width, height, frameRate, ptsDiff }
}

async function runVmaf(
  referencePath: string,
  degradedPath: string,
  preview = true,
) {
  log.debug('runVmaf', { referencePath, degradedPath })
  const comparisonPath =
    referencePath.replace(/\.[^.]+$/, '_compared-with_') +
    path.basename(degradedPath.replace(/\.[^.]+$/, ''))
  const vmafLogPath = comparisonPath + '.vmaf.json'
  const cpus = os.cpus().length

  const { width, height, frameRate, ptsDiff } = await alignVideos(
    referencePath,
    degradedPath,
  )

  const cmd = preview
    ? `ffmpeg -loglevel warning -y -threads ${cpus} \
-i ${degradedPath} \
-ss ${ptsDiff / frameRate} -i ${referencePath} \
-filter_complex '\
[0:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame,fps=fps=${frameRate},split[deg1][deg2];\
[1:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame,fps=fps=${frameRate},split[ref1][ref2];\
[deg1][ref1]libvmaf=log_fmt=json:log_path=${vmafLogPath}:n_subsample=1:n_threads=${cpus}[vmaf];\
[ref2][deg2]hstack=shortest=1[stacked]' \
-shortest \
-map [vmaf] -f null - \
-map [stacked] -c:v libx264 -crf 20 -f mp4 ${comparisonPath + '.mp4'} \
`
    : `ffmpeg -loglevel warning -y -threads ${cpus} \
-i ${degradedPath} \
-ss ${ptsDiff / frameRate} -i ${referencePath} \
-filter_complex '\
[0:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame,fps=fps=${frameRate}[deg];\
[1:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame,fps=fps=${frameRate}[ref];\
[deg][ref]libvmaf=log_fmt=json:log_path=${vmafLogPath}:n_subsample=1:n_threads=${cpus}[vmaf]' \
-shortest \
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

export async function calculateVmafScore(
  referencePath: string,
  degradedPaths: string[],
): Promise<void> {
  log.debug(
    ` calculateVmafScore referencePath=${referencePath} degradedPaths=${degradedPaths}`,
  )

  for (const degradedPath of degradedPaths) {
    await runVmaf(referencePath, degradedPath)
  }
}
