// Empty react-native for plain-Node tests. See nodeShims.ts.
module.exports = { Platform: { OS: "android", select: (o) => o.android ?? o.default } };
