const _ = require('lodash');
const minimist = require('minimist');

if (_.chunk([1, 2, 3, 4], 2).length !== 2) throw new Error('lodash broken');
if (minimist(['--name', 'bob']).name !== 'bob') throw new Error('minimist broken');

console.log('fixture tests passed');
