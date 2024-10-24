import fs from 'fs'
import json5 from 'json5'
import os from 'os'
import path from 'path'

import { FastStats } from './stats'
import {
  analyzeColors,
  buildIvfHeader,
  chunkedPromiseAll,
  ffmpeg,
  ffprobe,
  FFProbeProcess,
  getFiles,
  logger,
  runShellCommand,
} from './utils'

const log = logger('webrtcperf:vmaf')

export type IvfFrame = {
  index: number
  position: number
  size: number
}

export async function parseVideo(fpath: string) {
  let width = 0
  let height = 0
  let frameRate = 0
  await ffprobe(fpath, 'video', 'frame=pts,width,height,duration_time', '', frame => {
    const w = parseInt(frame.width)
    const h = parseInt(frame.height)
    if (w > width) width = w
    if (h > height) height = h
    const duration = parseFloat(frame.duration_time)
    if (duration) {
      frameRate = Math.max(Math.round(1 / duration), frameRate)
    }
    return FFProbeProcess.Skip
  })
  return { width, height, frameRate }
}

export async function convertToIvf(fpath: string, crop?: Crop, keepSourceFile = true) {
  const { width, height, frameRate } = await parseVideo(fpath)
  const outputPath = fpath.replace(/\.[^.]+$/, '.ivf.raw')
  log.debug(`convertToIvf ${fpath} ${width}x${height}@${frameRate} -> ${outputPath}`)

  const fd = await fs.promises.open(outputPath, 'w')
  const header = buildIvfHeader(
    width - (crop?.left || 0) - (crop?.right || 0),
    height - (crop?.top || 0) - (crop?.bottom || 0),
    frameRate,
    'VP80',
  )
  await fd.write(header)

  let pts = 0
  let pos = header.byteLength
  const filter = crop ? cropFilter(crop) : ''
  await ffmpeg(
    `-y -i ${fpath} -map 0:v -c:v vp8 -quality good -cpu-used 0 -crf 1 -b:v 20M -qmin 1 -qmax 10 -g 1 -threads ${os.cpus().length} -vf '${filter}' -an -f data`,
    async data => {
      const { byteLength } = data
      const frameHeader = Buffer.alloc(12)
      frameHeader.writeUInt32LE(byteLength, 0)
      frameHeader.writeBigUInt64LE(BigInt(pts), 4)
      await fd.write(frameHeader, 0, 12, pos)
      await fd.write(data, 0, byteLength, pos + 12)
      pos += 12 + byteLength
      pts++
    },
  )
  header.writeUint32LE(pts, 24)
  await fd.write(header, 0, header.byteLength, 0)
  log.debug(`${outputPath} pts: ${pts} size: ${pos}`)
  await fd.close()

  await fixIvfFrames(outputPath, keepSourceFile)
}

export async function recognizeFrames(
  fpath: string,
  recover = false,
  crop = { top: 0, bottom: 0, left: 0, right: 0 },
  debug = false,
) {
  const { width, height, frameRate } = await parseVideo(fpath)
  const fname = path.basename(fpath)
  const frames = new Map<number, number>()
  let skipped = 0
  let failed = 0
  let recovered = 0
  let firstTimestamp = 0
  let lastTimestamp = 0
  let participantDisplayName = ''
  const regExp = /(?<name>[0-9]{1,6})-(?<time>[0-9]{13,13})/
  await ffprobe(
    fpath,
    'video',
    'frame=pts,frame_tags=lavfi.ocr.text,lavfi.ocr.confidence',
    `crop=in_w-${crop.left}-${crop.right}:in_h-${crop.top}-${crop.bottom}:${crop.left}:${crop.top},crop=in_w:max((in_h/18)*1.2\\,24):0:0,ocr=whitelist=0123456789-`,
    frame => {
      const pts = parseInt(frame.pts)
      if ((!frames.has(pts) || !frames.get(pts)) && frameRate) {
        const confidence = parseFloat(frame.tag_lavfi_ocr_confidence?.trim() || '0')
        const textMatch = (frame.tag_lavfi_ocr_text?.trim() || '').match(regExp)
        if (confidence > 50 && textMatch) {
          const { name, time } = textMatch.groups as { name: string; time: string }
          participantDisplayName = `Participant-${name.padStart(6, '0')}`
          const recognizedTime = parseInt(time)
          const recognizedPts = Math.round((frameRate * recognizedTime) / 1000)
          debug &&
            log.debug(
              `recognized frame ${fname} confidence=${confidence} pts=${pts} name=${name} time=${time} recognized=${recognizedPts}`,
            )
          frames.set(pts, recognizedPts)
          if (!firstTimestamp) firstTimestamp = recognizedPts / frameRate
          lastTimestamp = recognizedPts / frameRate
        } else {
          recover && frames.set(pts, 0)
          failed++
        }
      } else {
        skipped++
      }
      return FFProbeProcess.Skip
    },
  )

  if (recover) {
    const ptsIndex = Array.from(frames.keys()).sort((a, b) => a - b)
    for (const [i, pts] of ptsIndex.entries()) {
      const recognizedPts = frames.get(pts)
      if (!recognizedPts && i) {
        const prevRecognizedPts = frames.get(ptsIndex[i - 1])
        if (prevRecognizedPts) {
          frames.set(pts, prevRecognizedPts + pts - ptsIndex[i - 1])
          recovered++
        } else {
          frames.delete(pts)
        }
      }
    }
  }

  log.info(
    `recognizeFrames ${fname} ${width}x${height}@${frameRate} "${participantDisplayName}" frames: ${frames.size} skipped: ${skipped} recovered: ${recovered} failed: ${failed} \
ts: ${firstTimestamp.toFixed(2)}-${lastTimestamp.toFixed(2)} (${(lastTimestamp - firstTimestamp).toFixed(2)})`,
  )
  return { width, height, frameRate, frames, participantDisplayName }
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
    const ret = await fd.read(frameHeaderView, 0, frameHeaderView.byteLength, position)
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
    const { frames: ptsToRecognized, participantDisplayName: name } = await recognizeFrames(fpath)
    participantDisplayName = name
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

export async function fixIvfFrames(filePath: string, keepSourceFile = true) {
  const fname = path.basename(filePath)
  const dirPath = path.dirname(filePath)
  if (!fname.endsWith('.ivf.raw')) {
    throw new Error(`fixIvfFrames ${fname}: invalid file extension, expected ".ivf.raw"`)
  }
  const { width, height, frames, participantDisplayName } = await parseIvf(filePath, true)
  if (!participantDisplayName) {
    throw new Error(`fixIvfFrames ${fname}: no participant name found`)
  }
  if (!frames.size) {
    throw new Error(`fixIvfFrames ${fname}: no frames found`)
  }
  log.debug(`fixIvfFrames ${fname} width=${width} height=${height} (${frames.size} frames)`)
  const fd = await fs.promises.open(filePath, 'r')

  const parts = path.basename(filePath).split('_')
  if (!parts[1].startsWith('send') && !parts[1].startsWith('recv')) {
    throw new Error(`fixIvfFrames ${fname}: invalid file name, expected "<name>_send" or "<name>_recv"`)
  }
  const outFilePath = path.join(
    dirPath,
    parts[1].startsWith('send') ? `${participantDisplayName}.ivf` : `${participantDisplayName}_recv-by_${parts[0]}.ivf`,
  )

  const fixedFd = await fs.promises.open(outFilePath, 'w')
  const headerView = new DataView(new ArrayBuffer(32))
  await fd.read(headerView, 0, headerView.byteLength, 0)

  let position = 32
  let writtenFrames = 0

  const ptsIndex = Array.from(frames.keys()).sort((a, b) => a - b)
  for (const pts of ptsIndex) {
    const frame = frames.get(pts)
    if (!frame) {
      log.warn(`fixIvfFrames ${fname}: pts ${pts} not found, skipping`)
      continue
    }
    const frameView = new DataView(new ArrayBuffer(frame.size))
    await fd.read(frameView, 0, frame.size, frame.position)
    frameView.setBigUint64(4, BigInt(pts), true)
    await fixedFd.write(new Uint8Array(frameView.buffer), 0, frameView.byteLength, position)
    position += frameView.byteLength
    writtenFrames++
  }

  headerView.setUint32(24, writtenFrames, true)
  await fixedFd.write(new Uint8Array(headerView.buffer), 0, headerView.byteLength, 0)

  await fd.close()
  await fixedFd.close()

  if (!keepSourceFile) {
    await fs.promises.unlink(filePath)
  }

  return { participantDisplayName, outFilePath }
}

export async function fixIvfFiles(directory: string, keepSourceFiles = true) {
  const reference = new Map<string, string>()
  const degraded = new Map<string, string[]>()

  const addFile = (participantDisplayName: string, outFilePath: string) => {
    if (outFilePath.includes('_recv-by_')) {
      if (!degraded.has(participantDisplayName)) {
        degraded.set(participantDisplayName, [])
      }
      degraded.get(participantDisplayName)?.push(outFilePath)
    } else {
      reference.set(participantDisplayName, outFilePath)
    }
  }

  const ivfFiles = await getFiles(directory, '.ivf')
  if (ivfFiles.length) {
    log.info(`fixIvfFiles directory=${directory} ivfFiles=${ivfFiles}`)
    for (const outFilePath of ivfFiles) {
      try {
        const participantDisplayName = path.basename(outFilePath).replace('.ivf', '').split('_')[0]
        addFile(participantDisplayName, outFilePath)
      } catch (err) {
        log.error(`fixIvfFrames error: ${(err as Error).stack}`)
      }
    }
  }

  const rawFiles = await getFiles(directory, '.ivf.raw')
  if (rawFiles.length) {
    log.info(`fixIvfFiles directory=${directory} files=${rawFiles}`)
    const results = await chunkedPromiseAll<
      string,
      { participantDisplayName: string; outFilePath: string } | undefined
    >(
      rawFiles,
      async filePath => {
        try {
          const { participantDisplayName, outFilePath } = await fixIvfFrames(filePath, keepSourceFiles)
          return { participantDisplayName, outFilePath }
        } catch (err) {
          log.error(`fixIvfFrames error: ${(err as Error).stack}`)
        }
      },
      Math.ceil(os.cpus().length / 2),
    )
    for (const res of results) {
      if (!res) continue
      const { participantDisplayName, outFilePath } = res
      addFile(participantDisplayName, outFilePath)
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
    await fixedFd.write(new Uint8Array(frameView.buffer), 0, frameView.byteLength, position)
    position += frameView.byteLength
    writtenFrames++
  }

  headerView.setUint32(24, writtenFrames, true)
  await fixedFd.write(new Uint8Array(headerView.buffer), 0, headerView.byteLength, 0)

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
  cropConfig: VmafCrop = {},
  cropTimeOverlay = false,
) {
  const comparisonDir = path.dirname(degradedPath)
  const comparisonName = path.basename(degradedPath.replace(/\.[^.]+$/, ''))
  const cropDest = cropConfig[comparisonName] || {}
  const crop = { deg: cropDest.deg ? { ...cropDest.deg } : {}, ref: cropDest.ref ? { ...cropDest.ref } : {} }

  log.info('runVmaf', { referencePath, degradedPath, preview, crop })
  await fs.promises.mkdir(path.join(comparisonDir, comparisonName), { recursive: true })
  const vmafLogPath = path.join(comparisonDir, comparisonName, 'vmaf.json')
  const psnrLogPath = path.join(comparisonDir, comparisonName, 'psnr.log')
  const comparisonPath = path.join(comparisonDir, comparisonName, 'comparison.mp4')
  const cpus = os.cpus().length

  const sender = path.basename(referencePath).replace('.ivf', '')
  const receiver = path.basename(degradedPath).replace('.ivf', '').split('_recv-by_')[1]

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
  const refTextHeight = cropTimeOverlay ? Math.round(Math.round(refHeight / 18) * 1.2) : 0
  const degTextHeight = cropTimeOverlay ? Math.round(Math.round(degHeight / 18) * 1.2) : 0

  if (!crop.ref) crop.ref = {}
  crop.ref.top = (crop.ref.top || 0) + refTextHeight

  if (!crop.deg) crop.deg = {}
  crop.deg.top = (crop.deg.top || 0) + degTextHeight

  // Adjust the reference aspect ratio to match the degraded one.
  const refAspectRatio = refWidth / refHeight
  const degAspectRatio = degWidth / degHeight
  if (refAspectRatio > degAspectRatio) {
    const diff = (refWidth - refHeight * degAspectRatio) / 2
    crop.ref.left = (crop.ref.left || 0) + diff
    crop.ref.right = (crop.ref.right || 0) + diff
  }

  // Scale using the minimum width and height.
  const width = Math.min(
    refWidth - (crop.ref.left || 0) - (crop.ref.right || 0),
    degWidth - (crop.deg.left || 0) - (crop.deg.right || 0),
  )
  const height = Math.min(
    refHeight - (crop.ref.top || 0) - (crop.ref.bottom || 0),
    degHeight - (crop.deg.top || 0) - (crop.deg.bottom || 0),
  )

  if (refFrameRate !== degFrameRate) {
    throw new Error(`runVmaf: frame rates do not match: ref=${refFrameRate} deg=${degFrameRate}`)
  }
  const frameRate = refFrameRate

  // Find common frames.
  const commonRefFrames = []
  const commonDegFrames = []
  for (const [pts, refFrame] of refFrames.entries()) {
    const degFrame = degFrames.get(pts)
    if (degFrame) {
      commonRefFrames.push(refFrame)
      commonDegFrames.push(degFrame)
    }
  }
  referencePath = await filterIvfFrames(referencePath, commonRefFrames)
  degradedPath = await filterIvfFrames(degradedPath, commonDegFrames)
  log.debug(`common frames: ${commonRefFrames.length} ref: ${refFrames.size} deg: ${degFrames.size}`, {
    width,
    height,
    ...crop,
  })

  const ffmpegCmd = `ffmpeg -loglevel warning -y -threads ${cpus} \
-i ${degradedPath} \
-i ${referencePath} \
`

  const filter = `\
[0:v]\
${cropFilter(crop.deg, ',')}\
${scaleFilter(width, height)}\
${preview ? ',split=3[deg1][deg2][deg3]' : 'split=32[deg1][deg2]'};\
[1:v]\
${cropFilter(crop.ref, ',')}\
${scaleFilter(width, height)}\
${preview ? ',split=3[ref1][ref2][ref3]' : 'split=2[ref1][ref2]'};\
[deg1][ref1]libvmaf=model='path=/usr/share/model/vmaf_v0.6.1.json':log_fmt=json:log_path=${vmafLogPath}:n_subsample=1:n_threads=${cpus}:shortest=1[vmaf];\
[deg2][ref2]psnr=stats_file=${psnrLogPath}[psnr]\
`

  const cmd = preview
    ? `${ffmpegCmd} \
-filter_complex "${filter};[ref3][deg3]hstack[stacked]" \
-map [vmaf] -f null - \
-map [psnr] -f null - \
-map [stacked] -fps_mode vfr -c:v libx264 -crf 10 -f mp4 -movflags +faststart ${comparisonPath} \
`
    : `${ffmpegCmd} \
-filter_complex "${filter}" \
-map [vmaf] -f null - \
-map [psnr] -f null - \
`

  log.debug('runVmaf', cmd)
  try {
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

    log.info(`VMAF metrics ${vmafLogPath}:`, metrics)

    await writeGraph(vmafLogPath, frameRate)

    return metrics
  } finally {
    await fs.promises.unlink(degradedPath)
    await fs.promises.unlink(referencePath)
  }
}

async function writeGraph(vmafLogPath: string, frameRate: number) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ChartJSNodeCanvas } = require('chartjs-node-canvas')

  const vmafLog = JSON.parse(await fs.promises.readFile(vmafLogPath, 'utf-8')) as {
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
          text: path.basename(vmafLogPath).replace('.vmaf.json', '').replace(/_/g, ' '),
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

type VmafCrop = Record<
  string,
  {
    ref?: Crop
    deg?: Crop
  }
>

const cropFilter = (crop?: Crop, suffix = '') => {
  if (!crop) return ''
  const { top, bottom, left, right } = crop
  if (!top && !bottom && !left && !right) return `crop${suffix}`
  const width = (left || 0) + (right || 0)
  const height = (top || 0) + (bottom || 0)
  return `crop=w=iw-${width}:h=ih-${height}:x=${left || 0}:y=${top || 0}:exact=1${suffix}`
}

const scaleFilter = (width?: number, height?: number, suffix = '') => {
  return `scale=w=${width || 'in_w'}:h=${height || 'in_h'}:flags=bicubic${suffix}`
}

type VmafConfig = {
  vmafPath: string
  vmafPreview: boolean
  vmafKeepIntermediateFiles: boolean
  vmafKeepSourceFiles: boolean
  vmafCrop?: string
}

export async function calculateVmafScore(config: VmafConfig): Promise<VmafScore[]> {
  const { vmafPath, vmafPreview, vmafKeepIntermediateFiles, vmafKeepSourceFiles, vmafCrop } = config
  if (!fs.existsSync(config.vmafPath)) {
    throw new Error(`VMAF path ${config.vmafPath} does not exist`)
  }
  log.debug(`calculateVmafScore referencePath=${vmafPath}`)

  const { reference, degraded } = await fixIvfFiles(vmafPath, vmafKeepSourceFiles)
  const crop = vmafCrop ? (json5.parse(vmafCrop) as VmafCrop) : undefined

  const ret: VmafScore[] = []
  for (const participantDisplayName of reference.keys()) {
    const vmafReferencePath = reference.get(participantDisplayName)
    if (!vmafReferencePath) continue
    for (const degradedPath of degraded.get(participantDisplayName) || []) {
      try {
        const metrics = await runVmaf(vmafReferencePath, degradedPath, vmafPreview, crop)
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
  await fs.promises.writeFile(path.join(vmafPath, 'vmaf.json'), JSON.stringify(ret, undefined, 2))

  return ret
}

if (require.main === module) {
  ;(async (): Promise<void> => {
    switch (process.argv[2]) {
      case 'convert':
        await convertToIvf(process.argv[3], json5.parse(process.argv[4]) as Crop, false)
        break
      case 'analyze':
        console.log(JSON.stringify(await analyzeColors(process.argv[3]), null, 2))
        break
      case 'graph':
        await writeGraph(process.argv[3], 30)
        break
      case 'vmaf':
        await calculateVmafScore({
          vmafPath: process.argv[3],
          vmafPreview: true,
          vmafKeepIntermediateFiles: true,
          vmafKeepSourceFiles: true,
          vmafCrop: json5.stringify({
            'Participant-000001_recv-by_Participant-000000': {
              deg: { top: 0, bottom: 0, left: 0, right: 0 },
              ref: { top: 0, bottom: 0, left: 0, right: 0 },
            },
          }),
        })
        break
      default:
        throw new Error(`Invalid command: ${process.argv[2]}`)
    }
  })()
    .catch(err => console.error(err))
    .finally(() => process.exit(0))
}
