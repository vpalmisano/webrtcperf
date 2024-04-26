import { ChartJSNodeCanvas } from 'chartjs-node-canvas'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createScheduler, createWorker, PSM } from 'tesseract.js'

import { getFiles, logger, runShellCommand } from './utils'

const log = logger('webrtcperf:vmaf')

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
  participantDisplayName?: string
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
    await fd.close()
    throw new Error('Invalid IVF file')
  }
  const width = headerView.getUint16(12, true)
  const height = headerView.getUint16(14, true)
  const den = headerView.getUint32(16, true)
  const num = headerView.getUint32(20, true)
  const frameRate = den / num
  let participantDisplayName = ''

  const frameHeaderView = new DataView(new ArrayBuffer(12))
  let index = 0
  let position = 32
  let bytesRead = 0
  let frames = new Map<number, IvfFrame>()
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
    const participantDisplayNameWorker = await createWorker('eng')
    await participantDisplayNameWorker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      tessedit_char_whitelist: 'Participant-0123456789d',
    })

    const ptsToRecognized = new Map<number, number>()
    const textHeight = Math.ceil(height / 18) + 6

    const recognizeFrame = async (pts: number, index: number) => {
      const frame = frames.get(pts)
      if (!frame) {
        log.warn(`IVF file ${fpath}: pts ${pts} not found, skipping`)
        return
      }
      const { size, position } = frame

      const frameView = new DataView(new ArrayBuffer(size))
      await fd.read(frameView, 0, size, position + 12)
      const buffer = Buffer.from(frameView.buffer, 0, frameView.byteLength)

      const ret = await tesseractScheduler.addJob('recognize', buffer, {
        rectangle: { top: 0, left: 0, width: width / 2, height: textHeight },
      })
      const { data } = ret
      const recognizedTime = parseInt(data.text.trim() || '0')
      if (data.confidence < 75 || !recognizedTime) {
        log.debug(
          `recognize pts=${index}/${
            frames.size
          } failed: text=${data.text.trim()} confidence=${
            data.confidence
          } recognizedTime=${recognizedTime}`,
        )
        ptsToRecognized.set(pts, 0)
        return
      } else {
        log.debug(
          `recognize pts=${index}/${
            frames.size
          } text=${data.text.trim()} confidence=${
            data.confidence
          } recognizedTime=${recognizedTime ? new Date(recognizedTime) : ''}`,
        )
      }
      const recognizedPts = Math.round((frameRate * recognizedTime) / 1000)
      ptsToRecognized.set(pts, recognizedPts)

      if (!participantDisplayName) {
        participantDisplayName = '-'
        const ret = await participantDisplayNameWorker.recognize(buffer, {
          rectangle: {
            top: height - textHeight,
            left: 0,
            width,
            height: textHeight,
          },
        })
        const { data } = ret
        if (data.confidence > 75 && data.text.trim()) {
          participantDisplayName = data.text.trim()
          log.debug(
            `participantDisplayName="${participantDisplayName}" confidence=${data.confidence}`,
          )
        } else {
          log.warn(
            `participantDisplayName failed text="${data.text.trim()}" confidence=${
              data.confidence
            }`,
          )
          participantDisplayName = ''
        }
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

    const ptsIndex = Array.from(ptsToRecognized.keys()).sort((a, b) => a - b)
    for (const [i, pts] of ptsIndex.entries()) {
      const recognizedPts = ptsToRecognized.get(pts)
      if (!recognizedPts && i) {
        const prevRecognizedPts = ptsToRecognized.get(ptsIndex[i - 1])
        if (prevRecognizedPts) {
          ptsToRecognized.set(pts, prevRecognizedPts + pts - ptsIndex[i - 1])
        } else {
          ptsToRecognized.delete(pts)
        }
      }
    }

    const recognizedFrames = new Map<number, IvfFrame>()
    for (const [pts, frame] of frames) {
      const recognizedPts = ptsToRecognized.get(pts)
      if (recognizedPts) {
        recognizedFrames.set(recognizedPts, frame)
      }
    }
    frames.clear()
    frames = recognizedFrames
  }

  await fd.close()

  const ptsIndex = Array.from(frames.keys()).sort((a, b) => a - b)
  return { width, height, frameRate, ptsIndex, frames, participantDisplayName }
}

export async function fixIvfFrames(fpath: string, outDir: string) {
  const { width, height, frameRate, frames, ptsIndex, participantDisplayName } =
    await parseIvf(fpath, true)
  if (!participantDisplayName) {
    throw new Error(`IVF file ${fpath}: no participant name found`)
  }
  if (!ptsIndex.length) {
    throw new Error(`IVF file ${fpath}: no frames found`)
  }
  log.debug(`fixIvfFrames ${fpath}`, { width, height, frameRate })
  const fd = await fs.promises.open(fpath, 'r')

  const parts = path.basename(fpath).split('_')
  const outFilePath = path.join(
    outDir,
    parts[1] === 'send'
      ? `${participantDisplayName}.ivf`
      : `${participantDisplayName}_recv-by_${parts[0]}.ivf`,
  )

  const fixedFd = await fs.promises.open(outFilePath, 'w')
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

    if (previousFrame && previousPts >= 0 && pts - 1 - previousPts > 0) {
      const missing = pts - 1 - previousPts
      if (missing > frameRate * 60 * 60) {
        throw new Error(
          `IVF file ${fpath}: too many frames missing: ${missing}`,
        )
      }
      /* log.debug(
        `IVF file ${fpath}: pts ${pts} missing ${missing} frames, copying previous`,
      ) */
      while (pts - previousPts - 1 > 0) {
        previousPts += 1
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

  return { participantDisplayName, outFilePath, startPts }
}

export async function fixIvfFiles(directory: string, keepSourceFiles = true) {
  const files = await getFiles(directory, '.ivf.raw')
  log.info(`fixIvfFiles directory=${directory} files=${files}`)

  const reference = new Map<string, string>()
  const degraded = new Map<string, string[]>()
  for (const filePath of files) {
    try {
      const { participantDisplayName, outFilePath } = await fixIvfFrames(
        filePath,
        directory,
      )
      if (outFilePath.includes('_recv-by_')) {
        if (!degraded.has(participantDisplayName)) {
          degraded.set(participantDisplayName, [])
        }
        degraded.get(participantDisplayName)?.push(outFilePath)
      } else {
        reference.set(participantDisplayName, outFilePath)
      }
      if (!keepSourceFiles) {
        await fs.promises.unlink(filePath)
      }
    } catch (err) {
      log.error(`fixIvfFrames error: ${(err as Error).message}`)
    }
  }
  log.info(`fixIvfFiles done`)

  return { reference, degraded }
}

export type VmafScore = {
  sender: string
  receiver: string
  min: number
  max: number
  mean: number
  harmonic_mean: number
}

export async function runVmaf(
  referencePath: string,
  degradedPath: string,
  preview: boolean,
) {
  log.info('runVmaf', { referencePath, degradedPath, preview })
  const comparisonPath = degradedPath.replace(/\.[^.]+$/, '')
  const vmafLogPath = comparisonPath + '.vmaf.json'
  const cpus = os.cpus().length

  const dir = path.dirname(referencePath)
  const sender = path.basename(referencePath).replace('.ivf', '')
  const receiver = path
    .basename(degradedPath)
    .replace('.ivf', '')
    .split('_recv-by_')[1]
  const referencePathMp4 = `${dir}/${sender}_sent-to_${receiver}.mp4`
  const degradedPathMp4 = `${dir}/${sender}_recv-by_${receiver}.mp4`

  const {
    width,
    height,
    frameRate,
    ptsIndex: referencePtsIndex,
  } = await parseIvf(referencePath, false)
  const { ptsIndex: degradedPtsIndex } = await parseIvf(degradedPath, false)
  const ptsDiff = degradedPtsIndex[0] - referencePtsIndex[0]
  log.debug('runVmaf', {
    referencePath,
    degradedPath,
    referencePtsIndex: referencePtsIndex[0],
    degradedPtsIndex: degradedPtsIndex[0],
    ptsDiff,
  })

  const textHeight = Math.ceil(height / 18) + 6
  const filter = `\
[0:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame,crop=${width}:${
    height - textHeight * 2
  }:0:${textHeight},fps=fps=${frameRate},split=3[deg1][deg2][deg3];\
[1:v]scale=w=${width}:h=${height}:flags=bicubic:eval=frame,crop=${width}:${
    height - textHeight * 2
  }:0:${textHeight},fps=fps=${frameRate},split=3[ref1][ref2][ref3];\
[deg1][ref1]libvmaf=model='path=/usr/share/model/vmaf_v0.6.1.json':log_fmt=json:log_path=${vmafLogPath}:n_subsample=1:n_threads=${cpus}[vmaf]`

  const cmd = preview
    ? `ffmpeg -loglevel warning -y -threads ${cpus} \
-i ${degradedPath} \
-ss ${ptsDiff / frameRate} -i ${referencePath} \
-filter_complex "${filter};[ref2][deg2]hstack[stacked]" \
-map [vmaf] -f null - \
-map [stacked] -c:v libx264 -crf 15 -f mp4 -movflags +faststart ${
        comparisonPath + '_comparison.mp4'
      } \
-map [ref3] -c:v libx264 -crf 15 -f mp4 -movflags +faststart ${referencePathMp4} \
-map [deg3] -c:v libx264 -crf 15 -f mp4 -movflags +faststart ${degradedPathMp4} \
`
    : `ffmpeg -loglevel warning -y -threads ${cpus} \
-i ${degradedPath} \
-ss ${ptsDiff / frameRate} -i ${referencePath} \
-filter_complex "${filter}" \
-map [vmaf] -f null - \
`

  log.debug('runVmaf', cmd)
  const { stdout, stderr } = await runShellCommand(cmd)
  const vmafLog = JSON.parse(await fs.promises.readFile(vmafLogPath, 'utf-8'))
  log.debug('runVmaf', {
    stdout,
    stderr,
  })
  const metrics = {
    sender,
    receiver,
    ...vmafLog['pooled_metrics']['vmaf'],
  } as VmafScore

  log.info(`VMAF metrics ${comparisonPath}:`, metrics)

  await writeGraph(vmafLogPath, frameRate)

  return metrics
}

async function writeGraph(vmafLogPath: string, frameRate = 24) {
  const vmafLog = JSON.parse(
    await fs.promises.readFile(vmafLogPath, 'utf-8'),
  ) as {
    frames: Array<{
      frameNum: number
      metrics: { vmaf: number }
    }>
    pooled_metrics: {
      vmaf: { min: number; max: number; mean: number; harmonic_mean: number }
    }
  }
  const { min, max, mean } = vmafLog.pooled_metrics.vmaf

  const fpath = vmafLogPath.replace('.json', '.png')

  const data = vmafLog.frames.reduce((prev, cur) => {
    if (cur.frameNum % frameRate === 0) {
      prev.push({ x: cur.frameNum, y: cur.metrics.vmaf / frameRate })
    } else {
      prev[prev.length - 1].y += cur.metrics.vmaf / frameRate
    }
    return prev
  }, [] as { x: number; y: number }[])

  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width: 1280,
    height: 720,
    backgroundColour: 'white',
  })

  const buffer = await chartJSNodeCanvas.renderToBuffer({
    type: 'line',
    data: {
      labels: data.map(d => d.x),
      datasets: [
        {
          label: `VMAF score (min: ${min.toFixed(2)}, max: ${max.toFixed(
            2,
          )}, mean: ${mean.toFixed(2)})`,
          data: data.map(d => d.y),
          fill: false,
          borderColor: '#417fcc',
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: path
            .basename(vmafLogPath)
            .replace('.vmaf.json', '')
            .replace(/_/g, ' '),
        },
      },
    },
  })
  await fs.promises.writeFile(fpath, buffer)
}

type VmafConfig = {
  vmafPath: string
  vmafPreview: boolean
  vmafKeepIntermediateFiles: boolean
  vmafKeepSourceFiles: boolean
}

export async function calculateVmafScore(
  config: VmafConfig,
): Promise<VmafScore[]> {
  const {
    vmafPath,
    vmafPreview,
    vmafKeepIntermediateFiles,
    vmafKeepSourceFiles,
  } = config
  if (!fs.existsSync(config.vmafPath)) {
    throw new Error(`VMAF path ${config.vmafPath} does not exist`)
  }
  log.debug(`calculateVmafScore referencePath=${vmafPath}`)

  const { reference, degraded } = await fixIvfFiles(
    vmafPath,
    vmafKeepSourceFiles,
  )

  const ret: VmafScore[] = []
  for (const participantDisplayName of reference.keys()) {
    const vmafReferencePath = reference.get(participantDisplayName)
    if (!vmafReferencePath) continue
    for (const degradedPath of degraded.get(participantDisplayName) || []) {
      try {
        const metrics = await runVmaf(
          vmafReferencePath,
          degradedPath,
          vmafPreview,
        )
        ret.push(metrics)
      } catch (err) {
        log.error(`runVmaf error: ${(err as Error).message}`)
      } finally {
        if (!vmafKeepIntermediateFiles) {
          await fs.promises.unlink(degradedPath)
        }
      }
    }
    if (!vmafKeepIntermediateFiles) {
      await fs.promises.unlink(vmafReferencePath)
    }
  }
  await fs.promises.writeFile(
    path.join(vmafPath, 'vmaf.json'),
    JSON.stringify(ret, undefined, 2),
  )

  return ret
}

if (require.main === module) {
  ;(async (): Promise<void> => {
    /* await writeGraph(process.argv[2]) */
  })().catch(err => console.error(err))
}
