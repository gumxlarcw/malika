module.exports = function ratio(a, b) {
    if (a == null || b == null || b === 0) return null;
    return (a / b) * 100;
};
