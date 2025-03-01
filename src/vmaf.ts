import fs from 'fs'
import json5 from 'json5'
import path from 'path'
import os from 'os'

import { FFProbeProcess, analyzeColors, chunkedPromiseAll, ffprobe, getFiles, logger, runShellCommand } from './utils'
import { FastStats } from './stats'

const log = logger('webrtcperf:vmaf')

const cpus = os.cpus().length

export interface IvfFrame {
  pts: number
  recognizedPts?: number
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

/**
 * It prepares a video file for VMAF evaluation applying a timestamp video overlay.
 * @param name The input video file path with the output id (e.g `filename.flv,1`).
 * @param crop If the video should be cropped.
 * @param keepSourceFile If the source file should be kept.
 */
export async function prepareVideo(
  {
    vmafPrepareVideo,
    vmafVideoCrop,
    videoWidth,
    videoHeight,
    videoFramerate,
    videoDuration,
  }: {
    vmafPrepareVideo: string
    vmafVideoCrop?: string
    videoWidth: number
    videoHeight: number
    videoFramerate: number
    videoDuration: number
  },
  keepSourceFile = true,
) {
  const [fpath, id] = vmafPrepareVideo.split(',')
  const outputPath = path.join(path.dirname(fpath), `${id}_send.mp4`)
  if (fs.existsSync(outputPath)) {
    throw new Error(`Output file ${outputPath} already exists`)
  }
  const { width, height, frameRate } = await parseVideo(fpath)
  log.info(
    `prepareVideo ${fpath} ${width}x${height}@${frameRate} -> ${outputPath} ${vmafVideoCrop && `crop: ${vmafVideoCrop}`}`,
  )
  const fontsize = Math.round((videoHeight || height) / 18)
  const textHeight = Math.round(fontsize * 1.2)
  const filter = vmafVideoCrop ? cropFilter(json5.parse(vmafVideoCrop), 0, ',') : ''
  await runShellCommand(
    `ffmpeg -hide_banner -loglevel warning -threads ${Math.min(cpus, 16)} \
${videoDuration ? `-t ${videoDuration}` : ''} \
-i ${fpath} \
-filter_complex "[0:v]scale=w=${videoWidth || width}:h=${videoHeight || height},fps=${videoFramerate || frameRate},${filter}\
drawbox=x=0:y=0:w=iw:h=${textHeight}:color=black:t=fill,\
drawtext=fontfile=/usr/share/fonts/truetype/noto/NotoMono-Regular.ttf:text='${id || 0}-%{eif\\:t*1000\\:u}':fontcolor=white:fontsize=${fontsize}:x=(w-text_w)/2:y=(${textHeight}-text_h)/2[out]" \
-map [out] -fps_mode vfr -c:v libx264 -crf 10 -an \
-f mp4 -movflags +faststart ${outputPath}`,
    true,
  )

  if (!keepSourceFile) {
    await fs.promises.unlink(fpath)
  }
}

/**
 * It converts a video file to VP8/IVF format.
 * @param fpath The input video file path.
 * @param crop The crop filter.
 * @param keepSourceFile If the source file should be kept.
 */
export async function convertToIvf(fpath: string, crop?: string, keepSourceFile = true) {
  const { width, height, frameRate } = await parseVideo(fpath)
  const outputPath = fpath.replace(/\.[^.]+$/, '.ivf.raw')
  log.debug(`convertToIvf ${fpath} ${width}x${height}@${frameRate} -> ${outputPath} crop:`, crop)

  const filter = crop ? `-vf '${cropFilter(json5.parse(crop))}'` : ''
  await runShellCommand(
    `ffmpeg -y -hide_banner -y -loglevel warning -i ${fpath} -map 0:v \
      -c:v vp8 -quality best -cpu-used 0 -crf 1 -b:v 20M -qmin 1 -qmax 10 \
      -g 1 -threads ${Math.min(cpus, 16)} ${filter} -an \
      -f ivf ${outputPath}`,
    true,
  )

  await fixIvfFrames(outputPath, keepSourceFile)
}

/**
 * It recognizes the frames of a video file using OCR.
 * @param fpath The input video file path.
 * @param recover If missing frames should be recovered.
 * @param crop If the video should be cropped.
 * @param debug Enable debug logging.
 */
export async function recognizeFrames(fpath: string, recover = false, debug = false) {
  const { width, height, frameRate } = await parseVideo(fpath)
  const fname = path.basename(fpath)
  const frames = new Map<number, number>()
  let skipped = 0
  let failed = 0
  let recovered = 0
  let firstTimestamp = 0
  let lastTimestamp = 0
  let participantDisplayName = ''
  const regExp = /(?<name>[0-9]{1,6})-(?<time>[0-9]{1,13})/
  await ffprobe(
    fpath,
    'video',
    'frame=pts,frame_tags=lavfi.ocr.text,lavfi.ocr.confidence',
    `scale=w=1280:h=-1:flags=bicubic,crop=w=min(iw\\,ih):h=max((ih/15)\\,32):x=(iw-ow)/2:y=0:exact=1,ocr=whitelist=0123456789-`,
    frame => {
      const pts = parseInt(frame.pts)
      if ((!frames.has(pts) || !frames.get(pts)) && frameRate) {
        const confidence = parseFloat(frame.tag_lavfi_ocr_confidence?.trim() || '0')
        const textMatch = regExp.exec(frame.tag_lavfi_ocr_text?.trim() || '')
        if (confidence > 0 && textMatch) {
          const { name, time } = textMatch.groups as { name: string; time: string }
          participantDisplayName = `Participant-${name.padStart(6, '0')}`
          const recognizedTime = parseInt(time)
          const recognizedPts = Math.round((frameRate * recognizedTime) / 1000)
          if (debug) {
            log.debug(
              `recognized frame ${fname} confidence=${confidence} pts=${pts} name=${name} time=${time} recognized=${recognizedPts}`,
            )
          }
          frames.set(pts, recognizedPts)
          if (!firstTimestamp) firstTimestamp = recognizedPts / frameRate
          lastTimestamp = recognizedPts / frameRate
        } else {
          if (recover) frames.set(pts, 0)
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
  const { width, height } = await parseVideo(fpath)
  const fname = path.basename(fpath)
  const fd = await fs.promises.open(fpath, 'r')
  const headerData = new ArrayBuffer(32)
  const headerView = new DataView(headerData)
  const ret = await fd.read(headerView, 0, 32, 0)
  if (ret.bytesRead !== 32) {
    await fd.close()
    throw new Error('Invalid IVF file')
  }
  const den = headerView.getUint32(16, true)
  const num = headerView.getUint32(20, true)
  const frameRate = den / num
  let participantDisplayName = ''
  let skipped = 0

  const frameHeaderView = new DataView(new ArrayBuffer(12))
  let index = 0
  let position = 32
  let bytesRead = 0
  const frames = new Map<number, IvfFrame>()
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
      frames.set(pts, { pts, index, position, size: size + 12 })
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
ts: ${firstTimestamp.toFixed(2)}-${lastTimestamp.toFixed(2)} (${(lastTimestamp - firstTimestamp).toFixed(2)}s)`,
  )

  if (runRecognizer) {
    const { frames: ptsToRecognized, participantDisplayName: name } = await recognizeFrames(fpath)
    participantDisplayName = name
    for (const [pts, frame] of frames.entries()) {
      const recognizedPts = ptsToRecognized.get(pts)
      if (!recognizedPts) continue
      frame.recognizedPts = recognizedPts
    }
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

  const ptsIndex = Array.from(frames.keys())
    .filter(pts => frames.get(pts)?.recognizedPts)
    .sort((a, b) => {
      if (a === b) return (frames.get(a)?.recognizedPts || 0) - (frames.get(b)?.recognizedPts || 0)
      return a - b
    })
  for (const [i, pts] of ptsIndex.entries()) {
    const frame = frames.get(pts)
    if (!frame || !frame.recognizedPts) {
      log.warn(`fixIvfFrames ${fname}: pts ${pts} not found, skipping`)
      continue
    }

    const prevFrame = frames.get(ptsIndex[i - 1])
    const nextFrame = frames.get(ptsIndex[i + 1])
    // Skip frames that are not in the correct order.
    if (nextFrame?.recognizedPts && (nextFrame?.recognizedPts || 0) < frame.recognizedPts) {
      continue
    }
    // Keep duplicated frames.
    if (prevFrame?.recognizedPts && frame.recognizedPts === prevFrame.recognizedPts) {
      /* log.warn(
        `${frame.index} pts=${pts}:${frame.recognizedPts} prev ${prevFrame.pts}(${pts - prevFrame.pts}):${prevFrame.recognizedPts}(${frame.recognizedPts - prevFrame.recognizedPts}) next ${nextFrame?.pts}(${(nextFrame?.pts || 0) - pts}):${nextFrame?.recognizedPts}(${(nextFrame?.recognizedPts || 0) - frame.recognizedPts})`,
      ) */
      frame.recognizedPts = prevFrame.recognizedPts + 1
    }
    const frameView = new DataView(new ArrayBuffer(frame.size))
    await fd.read(frameView, 0, frame.size, frame.position)
    frameView.setBigUint64(4, BigInt(frame.recognizedPts), true)
    await fixedFd.write(new Uint8Array(frameView.buffer), 0, frameView.byteLength, position)
    position += frameView.byteLength
    writtenFrames++
  }

  headerView.setUint16(12, width, true)
  headerView.setUint16(14, height, true)
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
    log.debug(`using existing ${ivfFiles.length} ivf files`)
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
    log.debug(`processing ${rawFiles.length} raw ivf files`)
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
      Math.ceil(cpus / 4),
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

export interface VmafScore {
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
  const cropDest = cropConfig[comparisonName]
  const crop = { ref: fixCrop(cropDest?.ref), deg: fixCrop(cropDest?.deg) }

  log.info('runVmaf', { referencePath, degradedPath, preview, crop })
  await fs.promises.mkdir(path.join(comparisonDir, comparisonName), { recursive: true })
  const vmafLogPath = path.join(comparisonDir, comparisonName, 'vmaf.json')
  const psnrLogPath = path.join(comparisonDir, comparisonName, 'psnr.log')
  const comparisonPath = path.join(comparisonDir, comparisonName, 'comparison.mp4')

  const sender = path.basename(referencePath).replace('.ivf', '')
  const receiver = path.basename(degradedPath).replace('.ivf', '').split('_recv-by_')[1]

  const { frameRate: refFrameRate, frames: refFrames } = await parseIvf(referencePath, false)
  const {
    width: degWidth,
    height: degHeight,
    frameRate: degFrameRate,
    frames: degFrames,
  } = await parseIvf(degradedPath, false)

  const textHeight = cropTimeOverlay ? '(ih/15)' : ''
  if (textHeight) {
    crop.ref.h = `${crop.ref.h}-${textHeight}`
    crop.ref.y = `${crop.ref.y}+${textHeight}`

    crop.deg.h = `${crop.deg.h}-${textHeight}`
    crop.deg.y = `${crop.deg.y}+${textHeight}`
  }

  if (refFrameRate !== degFrameRate) {
    throw new Error(`runVmaf: frame rates do not match: ref=${refFrameRate} deg=${degFrameRate}`)
  }

  // Find common frames.
  const commonRefFrames = []
  const commonDegFrames = []
  let firstPts = 0
  let lastPts = 0
  for (const [pts, refFrame] of refFrames.entries()) {
    const degFrame = degFrames.get(pts)
    if (degFrame) {
      commonRefFrames.push(refFrame)
      commonDegFrames.push(degFrame)
      if (!firstPts) {
        firstPts = pts
      }
      lastPts = pts
    }
  }
  const duration = (lastPts - firstPts) / refFrameRate

  referencePath = await filterIvfFrames(referencePath, commonRefFrames)
  degradedPath = await filterIvfFrames(degradedPath, commonDegFrames)
  log.debug(
    `common frames: ${commonRefFrames.length} ref: ${refFrames.size} deg: ${degFrames.size} duration: ${duration}s`,
    {
      crop,
    },
  )

  const ffmpegCmd = `ffmpeg -hide_banner -loglevel warning -y -threads ${Math.min(cpus, 16)} \
-i ${degradedPath} \
-i ${referencePath} \
`

  const filter = `\
[0:v]\
scale=w=-1:h=${degHeight}:flags=bicubic,\
${cropFilter(crop.deg, 0, ',')}\
${splitFilter(['deg_vmaf', 'deg_psnr', preview ? 'deg_preview' : ''])};\
[1:v]\
scale=w=-1:h=${degHeight}:flags=bicubic,crop=w=${degWidth}:x=(iw-${degWidth})/2,\
${cropFilter(crop.ref, 0, ',')}\
${splitFilter(['ref_vmaf', 'ref_psnr', preview ? 'ref_preview' : ''])};\
[deg_vmaf][ref_vmaf]libvmaf=model='path=/usr/share/model/vmaf_v0.6.1.json':log_fmt=json:log_path=${vmafLogPath}:n_subsample=1:n_threads=${cpus}:shortest=1[vmaf];\
[deg_psnr][ref_psnr]psnr=stats_file=${psnrLogPath}[psnr]\
`

  const cmd = preview
    ? `${ffmpegCmd} \
-filter_complex "${filter};[ref_preview][deg_preview]hstack[stacked]" \
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

      ...vmafLog.pooled_metrics.vmaf,
    } as VmafScore

    log.info(`VMAF metrics ${vmafLogPath}:`, metrics)

    await writeGraph(vmafLogPath)

    return metrics
  } finally {
    await fs.promises.unlink(degradedPath)
    await fs.promises.unlink(referencePath)
  }
}

async function writeGraph(vmafLogPath: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ChartJSNodeCanvas } = require('chartjs-node-canvas')

  const vmafLog = JSON.parse(await fs.promises.readFile(vmafLogPath, 'utf-8')) as {
    frames: {
      frameNum: number
      metrics: { vmaf: number }
    }[]
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
            x: cur.frameNum,
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

interface Crop {
  w: string
  h: string
  x: string
  y: string
}

type VmafCrop = Record<
  string,
  {
    ref?: Crop
    deg?: Crop
  }
>

const fixCrop = (c?: Crop) => {
  return {
    w: c?.w ?? 'iw',
    h: c?.h ?? 'ih',
    x: c?.x ?? '0',
    y: c?.y ?? '0',
  }
}

const cropFilter = (crop: Crop, exact = 0, suffix = '') => {
  const { w, h, x, y } = crop
  if (!x && !w && !x && !y) return ''
  return `crop=w=${w}:h=${h}:x=${x}:y=${y}:exact=${exact}${suffix}`
}

const splitFilter = (outputs: string[], suffix = '') => {
  const out = outputs
    .filter(o => !!o)
    .map(o => `[${o}]`)
    .join('')
  if (!out) return ''
  return `split=${outputs.length}${out}${suffix}`
}

interface VmafConfig {
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

  const crop: VmafCrop | undefined = vmafCrop ? json5.parse(vmafCrop) : undefined

  const ret: VmafScore[] = []
  for (const participantDisplayName of reference.keys()) {
    const vmafReferencePath = reference.get(participantDisplayName)
    if (!vmafReferencePath) continue
    for (const degradedPath of degraded.get(participantDisplayName) ?? []) {
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
        await convertToIvf(process.argv[3], process.argv[4], false)
        break
      case 'parse': {
        const { frames } = await parseIvf(process.argv[3], true)
        console.log(frames)
        break
      }
      case 'fix':
        await fixIvfFrames(process.argv[3], true)
        break
      case 'analyze':
        console.log(JSON.stringify(await analyzeColors(process.argv[3]), null, 2))
        break
      case 'graph':
        await writeGraph(process.argv[3])
        break
      case 'vmaf':
        await calculateVmafScore({
          vmafPath: process.argv[3],
          vmafPreview: true,
          vmafKeepIntermediateFiles: true,
          vmafKeepSourceFiles: true,
          vmafCrop: json5.stringify({
            'Participant-000001_recv-by_Participant-000000': {
              ref: { w: '', h: '', x: '', y: '' },
              deg: { w: '', h: '', x: '', y: '' },
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
