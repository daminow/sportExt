module.exports = {
  apps: [
    {
      name: 'sportext-server',
      script: './src/server.js',
      cwd: '/root/sportExt/backend',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
