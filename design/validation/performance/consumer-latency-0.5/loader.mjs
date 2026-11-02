// Redirects the bare 'sh-ast' specifier to a prototype package directory (measurement only).
export async function resolve(specifier, context, next) {
  if (specifier === 'sh-ast' && process.env.SH_AST_OVERRIDE)
    return next(new URL(`file://${process.env.SH_AST_OVERRIDE}/dist/index.js`).href, context);
  return next(specifier, context);
}
