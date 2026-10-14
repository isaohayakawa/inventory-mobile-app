module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Lets drizzle-kit's generated migrations import .sql files as strings.
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
