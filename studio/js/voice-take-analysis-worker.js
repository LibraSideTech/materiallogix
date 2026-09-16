import { analyseTake } from './voice-take-analysis.js';

self.onmessage = event => {
  const { id, take } = event.data;
  try {
    self.postMessage({ id, result: analyseTake(take) });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
