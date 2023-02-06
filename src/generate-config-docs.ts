import { writeFile } from 'fs/promises'

import { getConfigDocs } from './config'

function formatJson(data: string): string {
  return `\`${data.replace(/\n/g, '')}\``
}

let data = `
The configuration properties are applied in the following order (from higher to
lower precedence):

- arguments passed to the executable in kebab case (e.g. \`--url-query\`);
- environment variables in uppercase snake format (e.g. \`URL_QUERY\`);
- \`config.json\` configuration file;
- default values.

`

const configDocs = getConfigDocs()
Object.entries(configDocs).forEach(entry => {
  const [name, value] = entry
  data += `\
## ${name}
${value.doc}

*Type*: \`${
    value.format === '"nat"'
      ? 'positive int'
      : value.format.replace(/^"(.+)"$/, '$1')
  }\`

*Default*: ${formatJson(value.default)}

`
})

data += `

---

`

writeFile('docs/config.md', data).then(
  () => {
	console.log('done'); // eslint-disable-line
  },
  err => {
	console.error(`Error writing file: ${err.message}`); // eslint-disable-line
  },
)
