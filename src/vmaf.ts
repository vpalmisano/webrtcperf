import fs from 'fs'
import json5 from 'json5'
import os from 'os'
import path from 'path'

import { FastStats } from './stats'
import { getFiles, logger, runShellCommand } from './utils'

const log = logger('webrtcperf:vmaf')

export type IvfFrame = {
  index: number
  position: number
  size: number
}

export async function recognizeFrames(fpath: string, frameRate: number) {
  const fname = path.basename(fpath)
  const cpus = os.cpus().length

  const [{ stdout }, { stdout: stdout2 }] = await Promise.all([
    runShellCommand(
      `ffprobe -loglevel error -threads ${cpus} -select_streams v -show_frames -print_format json=compact=1 \
 -show_entries frame=pts,frame_tags=lavfi.ocr.text,lavfi.ocr.confidence \
 -f lavfi -i 'movie=${fpath},crop=in_w:(in_h/18)+6:0:0,ocr=whitelist="0123456789"'`,
      false,
      10 * 1024 * 1024,
    ),
    runShellCommand(
      `ffprobe -loglevel error -threads ${cpus} -select_streams v -show_frames -print_format json=compact=1 \
 -show_entries frame=frame_tags=lavfi.ocr.text,lavfi.ocr.confidence \
 -f lavfi -i 'movie=${fpath},crop=in_w:(in_h/18)+6:0:in_h-(in_h/18)-6,fps=1/1,ocr=whitelist="Participant-0123456789"'`,
      false,
      10 * 1024 * 1024,
    ),
  ])

  const data = JSON.parse(stdout) as {
    frames: {
      pts: number
      tags: Record<string, string>
    }[]
  }

  const frames = new Map<number, number>()
  let skipped = 0
  let failed = 0
  let firstTimestamp = 0
  let lastTimestamp = 0

  data.frames.forEach(frame => {
    const { pts, tags } = frame
    if (!frames.has(pts) || !frames.get(pts)) {
      const recognizedTime = parseInt(tags['lavfi.ocr.text']?.trim() || '0')
      const confidence = parseFloat(tags['lavfi.ocr.confidence']?.trim() || '0')
      if (confidence > 50) {
        const recognizedPts = Math.round((frameRate * recognizedTime) / 1000)
        frames.set(pts, recognizedPts)
        if (!firstTimestamp) firstTimestamp = recognizedPts / frameRate
        lastTimestamp = recognizedPts / frameRate
      } else {
        frames.set(pts, 0)
        failed++
      }
    } else {
      skipped++
    }
  })

  const data2 = JSON.parse(stdout2) as {
    frames: {
      tags: Record<string, string>
    }[]
  }
  let participantDisplayName = ''
  for (const frame of data2.frames) {
    const text = frame.tags['lavfi.ocr.text']?.trim().split(' ')[0] || ''
    const confidence = parseFloat(
      frame.tags['lavfi.ocr.confidence']?.trim() || '0',
    )
    if (confidence > 50 && /^Participant-\d\d\d\d\d\d$/.test(text)) {
      participantDisplayName = text
      break
    }
  }

  log.info(
    `recognizeFrames ${fname} ${participantDisplayName} frames: ${frames.size} skipped: ${skipped} failed: ${failed} \
ts: ${firstTimestamp.toFixed(2)}-${lastTimestamp.toFixed(2)} (${(lastTimestamp - firstTimestamp).toFixed(2)})`,
  )
  return { frames, participantDisplayName }
}

async function parseIvf(fpath: string, runRecognizer = false) {
  const fname = path.basename(fpath)
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
  let skipped = 0

  const frameHeaderView = new DataView(new ArrayBuffer(12))
  let index = 0
  let position = 32
  let bytesRead = 0
  let frames = new Map<number, IvfFrame>()
  let firstTimestamp = 0
  let lastTimestamp = 0
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
      log.warn(`IVF file ${fname}: pts ${pts} <= prev ${ptsIndex[ptsIndex.length - 1]}`)
    } */
    if (frames.has(pts)) {
      /* log.debug(`IVF file ${fname}: pts ${pts} already present, skipping`) */
      skipped++
    } else {
      frames.set(pts, { index, position, size: size + 12 })
      index++
      if (!firstTimestamp) {
        firstTimestamp = pts / frameRate
      }
      lastTimestamp = pts / frameRate
    }
    position += size + 12
  } while (bytesRead === 12)
  await fd.close()

  log.debug(
    `parseIvf ${fname}: ${width}x${height}@${frameRate} \
frames: ${frames.size} skipped: ${skipped} \
ts: ${firstTimestamp.toFixed(2)}-${lastTimestamp.toFixed(2)} (${(lastTimestamp - firstTimestamp).toFixed(2)})`,
  )

  if (runRecognizer) {
    const { frames: ptsToRecognized, participantDisplayName: name } =
      await recognizeFrames(fpath, frameRate)
    participantDisplayName = name

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

  return {
    width,
    height,
    frameRate,
    frames,
    participantDisplayName,
  }
}

export async function fixIvfFrames(
  fpath: string,
  outDir: string,
  duplicate = false,
) {
  const fname = path.basename(fpath)
  const { width, height, frameRate, frames, participantDisplayName } =
    await parseIvf(fpath, true)
  if (!participantDisplayName) {
    throw new Error(`fixIvfFrames ${fname}: no participant name found`)
  }
  if (!frames.size) {
    throw new Error(`fixIvfFrames ${fname}: no frames found`)
  }
  log.debug(
    `fixIvfFrames ${fname} width=${width} height=${height} (${frames.size} frames)`,
  )
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
  let duplicatedFrames = 0
  let previousPts = -1
  let previousFrame: DataView | null = null

  const ptsIndex = Array.from(frames.keys()).sort((a, b) => a - b)
  for (const pts of ptsIndex) {
    const frame = frames.get(pts)
    if (!frame) {
      log.warn(`fixIvfFrames ${fname}: pts ${pts} not found, skipping`)
      continue
    }

    if (
      duplicate &&
      previousFrame &&
      previousPts >= 0 &&
      pts - previousPts - 1 > 0
    ) {
      const missing = pts - previousPts - 1
      if (missing > frameRate * 60) {
        log.warn(`${fname} too many frames missing: ${missing}`)
      } else {
        // log.debug(`${fname} pts ${pts} missing ${missing} frames, copying previous`)
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
    previousPts = pts
    previousFrame = frameView
  }
  previousFrame = null

  headerView.setUint32(24, writtenFrames, true)
  await fixedFd.write(
    new Uint8Array(headerView.buffer),
    0,
    headerView.byteLength,
    0,
  )

  await fd.close()
  await fixedFd.close()

  log.debug(
    `fixIvfFrames ${fname}: frames written: ${writtenFrames} duplicatedFrames: ${duplicatedFrames}`,
  )

  return { participantDisplayName, outFilePath }
}

export async function fixIvfFiles(directory: string, keepSourceFiles = true) {
  const reference = new Map<string, string>()
  const degraded = new Map<string, string[]>()

  const files = await getFiles(directory, '.ivf.raw')
  if (files.length) {
    log.info(`fixIvfFiles directory=${directory} files=${files}`)
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
        log.error(`fixIvfFrames error: ${(err as Error).stack}`)
      }
    }
  }

  const ivfFiles = await getFiles(directory, '.ivf')
  if (ivfFiles.length) {
    log.info(`fixIvfFiles directory=${directory} ivfFiles=${ivfFiles}`)
    for (const filePath of ivfFiles) {
      try {
        const participantDisplayName = path
          .basename(filePath)
          .replace('.ivf', '')
          .split('_')[0]
        if (filePath.includes('_recv-by_')) {
          if (!degraded.has(participantDisplayName)) {
            degraded.set(participantDisplayName, [])
          }
          const list = degraded.get(participantDisplayName)
          if (list && !list?.includes(filePath)) {
            list.push(filePath)
          }
        } else if (!reference.has(participantDisplayName)) {
          reference.set(participantDisplayName, filePath)
        }
      } catch (err) {
        log.error(`fixIvfFrames error: ${(err as Error).stack}`)
      }
    }
  }

  return { reference, degraded }
}

async function filterIvfFrames(fpath: string, frames: IvfFrame[]) {
  const outFilePath = fpath.replace('.ivf', '.filtered.ivf')
  const fd = await fs.promises.open(fpath, 'r')
  const fixedFd = await fs.promises.open(outFilePath, 'w')
  const headerView = new DataView(new ArrayBuffer(32))
  await fd.read(headerView, 0, headerView.byteLength, 0)

  let position = 32
  let writtenFrames = 0
  for (const frame of frames.values()) {
    const frameView = new DataView(new ArrayBuffer(frame.size))
    await fd.read(frameView, 0, frame.size, frame.position)
    await fixedFd.write(
      new Uint8Array(frameView.buffer),
      0,
      frameView.byteLength,
      position,
    )
    position += frameView.byteLength
    writtenFrames++
  }

  headerView.setUint32(24, writtenFrames, true)
  await fixedFd.write(
    new Uint8Array(headerView.buffer),
    0,
    headerView.byteLength,
    0,
  )

  await fd.close()
  await fixedFd.close()
  return outFilePath
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
  crop?: VmafCrop,
) {
  log.info('runVmaf', { referencePath, degradedPath, preview, crop })
  const comparisonPath = degradedPath.replace(/\.[^.]+$/, '')
  const vmafLogPath = comparisonPath + '.vmaf.json'
  const cpus = os.cpus().length

  const sender = path.basename(referencePath).replace('.ivf', '')
  const receiver = path
    .basename(degradedPath)
    .replace('.ivf', '')
    .split('_recv-by_')[1]

  const {
    width: refWidth,
    height: refHeight,
    frameRate: refFrameRate,
    frames: refFrames,
  } = await parseIvf(referencePath, false)
  const {
    width: degWidth,
    height: degHeight,
    frameRate: degFrameRate,
    frames: degFrames,
  } = await parseIvf(degradedPath, false)
  const width = Math.max(refWidth, degWidth)
  const height = Math.max(refHeight, degHeight)
  const frameRate = Math.max(refFrameRate, degFrameRate)

  const commonRefFrames = []
  const commonDegFrames = []
  for (const [pts, refFrame] of refFrames.entries()) {
    const degFrame = degFrames.get(pts)
    if (degFrame) {
      commonRefFrames.push(refFrame)
      commonDegFrames.push(degFrame)
    }
  }
  log.debug(
    `common frames ref: ${commonRefFrames.length}/${refFrames.size} deg: ${commonDegFrames.length}/${degFrames.size}`,
  )
  referencePath = await filterIvfFrames(referencePath, commonRefFrames)
  degradedPath = await filterIvfFrames(degradedPath, commonDegFrames)

  const ffmpegCmd = `ffmpeg -loglevel warning -y -threads ${cpus} \
-i ${degradedPath} \
-i ${referencePath}`

  const textHeight = Math.ceil(height / 18) + 6
  const filter = `\
[0:v]\
${cropFilter(crop?.deg, ',')}\
scale=w=${width}:h=${height},\
${cropFilter({ top: textHeight, bottom: textHeight })}\
${preview ? ',split=2[deg1][deg2]' : '[deg1]'};\
[1:v]\
${cropFilter(crop?.ref, ',')}\
scale=w=${width}:h=${height},\
${cropFilter({ top: textHeight, bottom: textHeight })}\
${preview ? ',split=2[ref1][ref2]' : '[ref1]'};\
[deg1][ref1]\
libvmaf=model='path=/usr/share/model/vmaf_v0.6.1.json':log_fmt=json:log_path=${vmafLogPath}:n_subsample=1:n_threads=${cpus}:shortest=1\
[vmaf]`

  const cmd = preview
    ? `${ffmpegCmd} \
-filter_complex "${filter};[ref2][deg2]hstack[stacked]" \
-map [vmaf] -f null - \
-map [stacked] -fps_mode vfr -c:v libx264 -crf 15 -g 10 -f mp4 -movflags frag_keyframe+delay_moov+skip_trailer ${
        comparisonPath + '_comparison.mp4'
      } \
`
    : `${ffmpegCmd} \
-filter_complex "${filter}" \
-shortest \
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

  await fs.promises.unlink(degradedPath)
  await fs.promises.unlink(referencePath)

  await writeGraph(vmafLogPath, frameRate)

  return metrics
}

async function writeGraph(vmafLogPath: string, frameRate: number) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ChartJSNodeCanvas } = require('chartjs-node-canvas')

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

  const decimation = Math.ceil(vmafLog.frames.length / 500)
  const stats = new FastStats()
  const data = vmafLog.frames
    .reduce(
      (prev, cur) => {
        if (cur.frameNum % decimation === 0) {
          prev.push({
            x: Math.round((100 * cur.frameNum) / frameRate) / 100,
            y: cur.metrics.vmaf,
            count: 1,
          })
        } else {
          prev[prev.length - 1].y += cur.metrics.vmaf
          prev[prev.length - 1].count++
        }
        stats.push(cur.metrics.vmaf)
        return prev
      },
      [] as { x: number; y: number; count: 1 }[],
    )
    .map(d => ({ x: d.x, y: d.y / d.count }))

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
          )}, mean: ${mean.toFixed(2)}, P5: ${stats.percentile(5).toFixed(2)})`,
          data: data.map(d => d.y),
          fill: false,
          borderColor: 'rgb(0, 0, 0)',
          borderWidth: 1,
          pointRadius: 0,
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
      scales: {
        y: {
          min: 0,
          max: 100,
        },
      },
    },
  })
  await fs.promises.writeFile(fpath, buffer)
}

type Crop = { top?: number; bottom?: number; left?: number; right?: number }

type VmafCrop = {
  ref?: Crop
  deg?: Crop
}

const cropFilter = (crop?: Crop, suffix = '') => {
  if (!crop) return ''
  const { top, bottom, left, right } = crop
  const width = (left || 0) + (right || 0)
  const height = (top || 0) + (bottom || 0)
  return `crop=w=iw-${width}:h=ih-${height}:x=${left || 0}:y=${top || 0}:exact=1${suffix}`
}

type VmafConfig = {
  vmafPath: string
  vmafPreview: boolean
  vmafKeepIntermediateFiles: boolean
  vmafKeepSourceFiles: boolean
  vmafCrop?: string
}

export async function calculateVmafScore(
  config: VmafConfig,
): Promise<VmafScore[]> {
  const {
    vmafPath,
    vmafPreview,
    vmafKeepIntermediateFiles,
    vmafKeepSourceFiles,
    vmafCrop,
  } = config
  if (!fs.existsSync(config.vmafPath)) {
    throw new Error(`VMAF path ${config.vmafPath} does not exist`)
  }
  log.debug(`calculateVmafScore referencePath=${vmafPath}`)

  const { reference, degraded } = await fixIvfFiles(
    vmafPath,
    vmafKeepSourceFiles,
  )
  const crop = vmafCrop ? (json5.parse(vmafCrop) as VmafCrop) : undefined

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
          crop,
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
    //return await writeGraph(process.argv[2], 30)
    await calculateVmafScore({
      vmafPath: process.argv[2],
      vmafPreview: true,
      vmafKeepIntermediateFiles: true,
      vmafKeepSourceFiles: true,
      vmafCrop: json5.stringify({}),
    })
  })()
    .catch(err => console.error(err))
    .finally(() => process.exit(0))
}
