// Keep repository text, filenames, and HTML language declarations in English.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {TextDecoder} = require('node:util');

const root = path.resolve(__dirname, '..');
const excludedDirectories = new Set(['.git', '.vscode', 'node_modules']);
const han = /\p{Script=Han}/u;
const cjkPunctuation = /[\u3000-\u3002\u3008-\u3011\u3014-\u301B\uFF01\uFF08\uFF09\uFF0C\uFF0E\uFF1A\uFF1B\uFF1F]/u;
// Match locale values without mistaking minified third-party identifiers for locales.
const chineseLocale = /\bz[h][-_](?:cn|tw|hk|mo|sg|hans|hant)(?:[-_][a-z]{2})?\b|["']z[h]["']|\b(?:lang|language|locale)\s*[:=]\s*z[h](?=[\s,>;}])/i;
const unicodeEscape = /\\u(?:\{([0-9a-f]{1,6})\}|([0-9a-f]{4}))/gi;
const numericEntity = /&#(?:x([0-9a-f]+)|([0-9]+));?/gi;
const percentEncoding = /(?:%[0-9a-f]{2}){2,}/gi;
const decoder = new TextDecoder('utf-8', {fatal:true});

function isHanCodePoint(value){
  return value <= 0x10ffff && han.test(String.fromCodePoint(value));
}

function violations(source){
  const reasons = [];
  if(han.test(source)) reasons.push('Han text');
  if(cjkPunctuation.test(source)) reasons.push('CJK punctuation');
  if(chineseLocale.test(source)) reasons.push('Chinese locale');
  const decodedEscapes = source.replace(/\p{Script=Han}/gu, '').replace(unicodeEscape, (match, braced, fixed) => {
    const value = parseInt(braced || fixed,16);
    return value <= 0x10ffff ? String.fromCodePoint(value) : match;
  });
  if(han.test(decodedEscapes)){
    reasons.push('Unicode-escaped Han text');
  }
  if([...source.matchAll(numericEntity)].some(match => isHanCodePoint(parseInt(match[1] || match[2],match[1] ? 16 : 10)))){
    reasons.push('HTML-encoded Han text');
  }
  if([...source.matchAll(percentEncoding)].some(match => {
    try{return han.test(decodeURIComponent(match[0]));}catch{return false;}
  })) reasons.push('URL-encoded Han text');
  return reasons;
}

// Exercise the scanner with generated fixtures without storing prohibited text.
const sample = String.fromCodePoint(0x4e2d);
assert.deepEqual(violations('English labels: Resume, Bloom Hero, ×5, ↗, …'), []);
assert.deepEqual(violations(sample), ['Han text']);
assert.deepEqual(violations(String.fromCodePoint(0xff0c)), ['CJK punctuation']);
assert.deepEqual(violations(['z','h','-CN'].join('')), ['Chinese locale']);
assert.deepEqual(violations('\\' + 'u' + '4e2d'), ['Unicode-escaped Han text']);
assert.deepEqual(violations('\\' + 'u{' + '4e2d}'), ['Unicode-escaped Han text']);
assert.deepEqual(violations('\\' + 'ud840' + '\\' + 'udc00'), ['Unicode-escaped Han text']);
assert.deepEqual(violations('&' + '#x' + '4e2d;'), ['HTML-encoded Han text']);
assert.deepEqual(violations('&' + '#' + '20013;'), ['HTML-encoded Han text']);
assert.deepEqual(violations(encodeURIComponent(sample)), ['URL-encoded Han text']);
assert.deepEqual(violations('class ' + ['z','h'].join('') + ' {}'), []);

const failures = [];
let textFiles = 0;
let htmlFiles = 0;
function inspectDirectory(directory){
  for(const entry of fs.readdirSync(directory, {withFileTypes:true})){
    if(entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    if(entry.name === '.DS_Store') continue;
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(root, fullPath);
    for(const reason of violations(relativePath)) failures.push(relativePath + ': path contains ' + reason);
    if(entry.isDirectory()){
      inspectDirectory(fullPath);
      continue;
    }
    if(!entry.isFile()) continue;
    const buffer = fs.readFileSync(fullPath);
    if(buffer.includes(0)) continue;
    let source;
    try{source = decoder.decode(buffer);}catch{continue;}
    textFiles++;
    for(const [index, line] of source.split(/\r?\n/).entries()){
      for(const reason of violations(line)) failures.push(relativePath + ':' + (index + 1) + ': ' + reason);
    }
    if(path.extname(fullPath).toLowerCase() === '.html'){
      htmlFiles++;
      const htmlTag = source.match(/<html\b[^>]*>/i)?.[0] || '';
      if(!/\blang\s*=\s*(["'])en\1/i.test(htmlTag)){
        failures.push(relativePath + ': HTML must declare lang="en"');
      }
    }
  }
}

inspectDirectory(root);
assert(textFiles > 0 && htmlFiles > 0, 'The scanner must inspect repository text and HTML files');
assert.equal(failures.length, 0, 'English-only repository violations:\n' + failures.join('\n'));
console.log('PASS English-only repository: ' + textFiles + ' text files and ' + htmlFiles + ' HTML language declarations');
