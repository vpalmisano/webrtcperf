#!/usr/bin/env node

import { parseArgs } from 'node:util'
import {
  aggregateStatsSummary,
  plotStatsSummary,
  uploadStatsToGoogleSheet,
  runShellCommand,
} from '../build/src/index.js'

async function main() {
  const { values } = parseArgs({
    options: {
      logs: { type: 'string', default: 'logs' },
      plot: { type: 'boolean', default: false },
      upload: { type: 'boolean', default: false },
    },
  })

  const stats = await aggregateStatsSummary({
    dirPath: values.logs,
    senderParticipantName: 'Participant-000001',
    receiverParticipantName: 'Participant-000000',
  })

  if (values.plot) {
    await plotStatsSummary(stats)
  }

  if (values.upload && process.env.GOOGLE_SHEET_ID) {
    console.log('Uploading stats to Google Sheet')
    await uploadStatsToGoogleSheet(stats, process.env.GOOGLE_SHEET_ID)
    await runShellCommand('mkdir -p logs-archived; mv logs/* logs-archived/')
  }
}

main().catch(console.error)
