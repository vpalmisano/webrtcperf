#!/usr/bin/env node

import { parseArgs } from 'node:util'
import { aggregateStatsSummary, plotStatsSummary, plotDetailedStatsDashboardSinglePage } from '../build/src/index.js'

async function main() {
  const { values } = parseArgs({
    options: {
      summary: { type: 'string', default: 'logs' },
      plot: { type: 'string', default: '' },
    },
  })

  if (values.summary) {
    const stats = await aggregateStatsSummary({
      dirPath: values.summary,
      senderParticipantName: 'Participant-000001',
      receiverParticipantName: 'Participant-000000',
    })

    await plotStatsSummary(stats)
  }

  if (values.plot) {
    await plotDetailedStatsDashboardSinglePage(values.plot)
  }
}

main().catch(console.error)
