import fs from 'fs'
import path from 'path'

import { getFiles, logger, runShellCommand } from './utils'

const log = logger('webrtcperf:visqol')

type VisqolConfig = {
  visqolPath: string
  visqolKeepSourceFiles: boolean
}

export async function calculateVisqolScore(
  config: VisqolConfig,
): Promise<void> {
  log.debug('calculateVisqolScore', config)
  const { visqolPath, visqolKeepSourceFiles } = config

  const ref = new Set<string>()
  const deg = new Set<string>()

  const files = await getFiles(visqolPath, '')
  for (const file of files) {
    if (!file.endsWith('.wav') && !file.endsWith('.f32le.raw')) continue
    const isSender = path.basename(file).includes('_send_')
    const isReceiver = path.basename(file).includes('_recv_')
    if (!isReceiver && !isSender) {
      continue
    }
    let outFile = file
    if (file.endsWith('.f32le.raw')) {
      outFile = path.join(
        path.dirname(file),
        path.basename(file).replace('.f32le.raw', '.wav'),
      )
      await runShellCommand(
        `ffmpeg -hide_banner -loglevel info -f f32le -ar 48000 -ac 1 -i ${file} -ac 1 ${outFile}`,
      )
      if (!visqolKeepSourceFiles) {
        fs.unlinkSync(file)
      }
    }
    if (isSender) {
      ref.add(outFile)
    } else if (isReceiver) {
      deg.add(outFile)
    }
  }
  for (const refFile of ref.values()) {
    for (const degFile of deg.values()) {
      log.info(`Calculating score ${refFile} -> ${degFile}`)
      try {
        await runShellCommand(
          `/usr/bin/visqol --reference_file ${refFile} --degraded_file ${degFile} --similarity_to_quality_model /usr/share/visqol/model/tcdaudio14_aacvopus_coresv_svrnsim_n.68_g.01_c1.model --results_csv ${path.dirname(refFile)}/visqol.csv`,
        )
      } catch (e) {
        log.error('Error calculating score:', (e as Error).stack)
      }
    }
  }
}

if (require.main === module) {
  ;(async (): Promise<void> => {
    await calculateVisqolScore({
      visqolPath: process.argv[2],
      visqolKeepSourceFiles: true,
    })
  })().catch(err => console.error(err))
}
