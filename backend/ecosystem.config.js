module.exports = {
  apps: [
    {
      name: 'sportext-server',
      script: './src/server.js',
      cwd: __dirname,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
