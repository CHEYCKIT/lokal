// "1 track", "2 tracks": a count with its word, singular for one.
export function plural(count, word, many = `${word}s`) {
  const n = Number(count) || 0
  return `${n.toLocaleString()} ${n === 1 ? word : many}`
}
