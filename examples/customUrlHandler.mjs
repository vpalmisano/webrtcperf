export default function ({
  id,
  sessions,
  tabIndex,
  tabsPerSession,
  index,
  pid,
}) {
  return `https://example.com/${id}/${sessions}/${tabIndex}/${tabsPerSession}/${index}/${pid}`
}
