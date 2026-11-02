// Resolve 'sh-ast' to an installed copy (SH_AST_DIR) and map './x.js' -> './x.ts' under oldsrc.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, next) {
  if (specifier === 'sh-ast')
    return next(new URL(`file://${process.env.SH_AST_DIR}/dist/index.js`).href, context);
  if (
    specifier.startsWith('./') &&
    specifier.endsWith('.js') &&
    context.parentURL?.includes('/oldsrc/')
  ) {
    const ts = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
    if (fs.existsSync(fileURLToPath(ts))) return next(ts.href, context);
  }
  return next(specifier, context);
}
