// mixes the two synced sources into one output: out = gainA·A + gainB·B.
// delta monitoring uses opposite-signed, independently trimmed gains.
class ABMixer extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "gainA", defaultValue: 1, automationRate: "a-rate" },
      { name: "gainB", defaultValue: 0, automationRate: "a-rate" },
    ];
  }

  process(inputs, outputs, parameters) {
    const [a, b] = inputs;
    const out = outputs[0];
    const { gainA, gainB } = parameters;

    for (let ch = 0; ch < out.length; ch++) {
      const o = out[ch];
      // fall back to channel 0 so a mono source feeds every output channel
      const aCh = a[ch] ?? a[0];
      const bCh = b[ch] ?? b[0];
      for (let i = 0; i < o.length; i++) {
        const ga = gainA.length > 1 ? gainA[i] : gainA[0];
        const gb = gainB.length > 1 ? gainB[i] : gainB[0];
        o[i] = ga * (aCh ? aCh[i] : 0) + gb * (bCh ? bCh[i] : 0);
      }
    }
    return true;
  }
}

registerProcessor("ab-mixer", ABMixer);
