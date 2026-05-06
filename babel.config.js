module.exports = function (api) {
  const platform = api.caller((caller) => caller?.platform) || 'android';
  api.cache.using(() => platform);
  process.env.EXPO_OS = platform;
  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: [
      ['transform-inline-environment-variables', { include: ['EXPO_OS'] }],
    ],
  };
};
