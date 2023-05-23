const esbuild = require('esbuild')

async function watch() {
  let ctx = await esbuild.context({
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
    color: true,
    plugins: [{
      name: 'on-end',
      setup(build) {
        build.onEnd(result => {
          if (result.errors.length > 0) {
            console.error('watch build failed: ', result.errors)
          } else {
            console.log(`watch build succeeded ${(new Date()).toISOString()}`)
          }
        })
      }
    }]
  })
  await ctx.watch()
  console.log('watching...')
}

watch()
