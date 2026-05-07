function buildKeyFromMeta(vervar, vari, turvar, tahun, turtahun) {
    return (
        String(vervar) +
        String(vari) +
        String(turvar) +
        String(tahun) +
        String(turtahun)
    );
}

function decodeKeyUsingMetadata(key, api) {
    const vervarList = api.vervar.map(v => v.val);
    const varList = api.var.map(v => v.val);
    const turvarList = api.turvar.map(t => t.val);
    const tahunList = api.tahun.map(t => t.val);
    const turtahunList = api.turtahun.map(t => t.val);

    key = key.toString();

    for (const v of vervarList) {
        for (const vr of varList) {
            for (const tv of turvarList) {
                for (const th of tahunList) {
                    for (const tt of turtahunList) {
                        const candidate = buildKeyFromMeta(v, vr, tv, th, tt);

                        if (candidate === key) {
                            return {
                                vervar: v,
                                var: vr,
                                turvar: tv,
                                tahun: th,
                                turtahun: tt
                            };
                        }
                    }
                }
            }
        }
    }

    return null;
}

module.exports = {
    decodeKeyUsingMetadata
};
