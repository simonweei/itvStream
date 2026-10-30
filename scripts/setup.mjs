import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
try {
 await writeFile('.dev.vars', 'ADMIN_PASSWORD=\nSESSION_SECRET='+randomBytes(32).toString('hex')+'\n', {flag:'wx',mode:0o600});
 console.log('已生成 .dev.vars，请填写 ADMIN_PASSWORD 后运行 npm run dev。');
} catch(error) { console.error(error.code==='EEXIST'?'.dev.vars 已存在，不覆盖。':error.message);process.exitCode=1;}
