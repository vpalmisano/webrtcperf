#!/usr/bin/env node

import { parseArgs } from 'node:util'
import { aggregateStatsSummary, plotStatsSummary } from '../build/src/index.js'

async function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string', default: 'logs' },
    },
  })

  const stats = await aggregateStatsSummary({
    dirPath: values.dir,
    senderParticipantName: 'Participant-000001',
    receiverParticipantName: 'Participant-000000',
  })

  await plotStatsSummary(stats)
}

main().catch(console.error)
