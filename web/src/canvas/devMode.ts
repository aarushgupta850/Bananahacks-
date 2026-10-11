// True when the URL has ?dev=1, which shows developer-only tools such as Export strokes.
export const isDevMode = () => new URLSearchParams(window.location.search).get('dev') === '1'
