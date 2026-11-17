const fs = require('fs'), path = require('path'), c = require('crypto');
exports.default = async ctx => {
  const r = path.join(ctx.appOutDir, 'resources');
  const h = c.createHash('sha256').update(fs.readFileSync(path.join(r, 'app.asar'))).digest('hex');
  fs.writeFileSync(path.join(r, 'app.sha256'), h);
};
