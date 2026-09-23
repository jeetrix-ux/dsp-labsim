import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
// monaco-editor 0.56 maps 'monaco-editor/*' to 'esm/vs/*.js' in its exports.
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

// Use the bundled Monaco instead of the CDN copy @monaco-editor/react loads by default.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco })
