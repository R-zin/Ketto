/** Distinct eight-second test pattern, louder than the original tone without clipping. */
export function audibleTestSample(index: number): number {
  const rate = 16000;
  const noteSamples = rate / 2;
  const position = index % noteSamples;
  const soundingSamples = Math.round(rate * 0.4);
  if (position >= soundingSamples) return 0;
  const fadeSamples = Math.round(rate * 0.01);
  const envelope = Math.min(1, position / fadeSamples, (soundingSamples - position) / fadeSamples);
  const frequency = Math.floor(index / noteSamples) % 2 === 0 ? 700 : 1000;
  return Math.round(18000 * envelope * Math.sin(2 * Math.PI * frequency * position / rate));
}
