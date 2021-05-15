const {getConfigDocs} = require('./src/config');
const {writeFile} = require('fs/promises');

// eslint-disable-next-line require-jsdoc
function formatJson(data) {
  return `\`${data.replace(/\n/g, '')}\``;
}

let data = `# Configuration

The configuration properties are applied in the following order (from higher to 
lower precedence):

- arguments passed to the executable in kebab case (e.g. \`url-query\`);
- environment variables in uppercase snake format (e.g. \`URL_QUERY\`);
- \`config.json\` configuration file;
- default values.

| Name | Description | Format | Default value |
| :--- | :---------- | :----- | :------------ |
`;

const configDocs = getConfigDocs();
Object.entries(configDocs).forEach((entry) => {
  const [name, value] = entry;

  // eslint-disable-next-line max-len
  data += `| ${name} | ${value.doc} | ${formatJson(value.format)} | \`${formatJson(value.default)}\` |\n`;
});

data += `

---

*Document generated with:* \`yarn generate-config-docs\`
`;

writeFile('CONFIG.md', data).then(() => {
	console.log('done'); // eslint-disable-line
}, (err) => {
	console.error(`Error writing file: ${err.message}`); // eslint-disable-line
});
