require('esbuild').build({
  define: {
    'process.env.NODE_ENV': `"${process.env.NODE_ENV}"`,
  },
  entryPoints: ['index.js'],
  outfile: 'dist/index.min.js',
  minify: true,
  sourcemap: true,
  platform: 'browser',
  format: 'esm',
  bundle: true,
  target: 'es2020',
  color: true
}).catch(err => {
  console.error(JSON.stringify(err, null, 2))
})
  .then(() => {
    console.log(new Date().toISOString(), ' compile start')
  })
