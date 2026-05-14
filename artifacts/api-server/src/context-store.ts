let activeContext: string | null = null;
let activeFilename: string | null = null;

export function setContext(text: string, filename: string) {
  activeContext = text;
  activeFilename = filename;
}

export function getContext(): string | null {
  return activeContext;
}

export function getFilename(): string | null {
  return activeFilename;
}

export function clearContext() {
  activeContext = null;
  activeFilename = null;
}
