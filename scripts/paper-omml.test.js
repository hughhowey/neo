'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const O = require('../paper/omml.js');

// MathML as MathJax writes it for the TeX in each test's name
const M = (inner, display) => `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}>${inner}</math>`;

test('E = mc^2: italic letters, upright numbers and operators, a superscript', () => {
  const o = O.fromMathml(M('<mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup>'));
  assert.equal(o, '<m:oMath><m:r><m:t xml:space="preserve">E</m:t></m:r><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t xml:space="preserve">=</m:t></m:r>'
    + '<m:r><m:t xml:space="preserve">m</m:t></m:r><m:sSup><m:e><m:r><m:t xml:space="preserve">c</m:t></m:r></m:e><m:sup><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t xml:space="preserve">2</m:t></m:r></m:sup></m:sSup></m:oMath>');
});

test('\\frac, \\sqrt, \\sqrt[3], \\sin (a function name, upright) and \\hat', () => {
  const o = O.fromMathml(M('<mfrac><mi>a</mi><mrow><mi>b</mi><mo>+</mo><mn>1</mn></mrow></mfrac><msqrt><mi>x</mi></msqrt><mroot><mi>y</mi><mn>3</mn></mroot><mi>sin</mi><mover><mi>x</mi><mo stretchy="false">^</mo></mover>'));
  assert.match(o, /<m:f><m:num><m:r><m:t xml:space="preserve">a<\/m:t><\/m:r><\/m:num><m:den>.*<\/m:den><\/m:f>/);
  assert.match(o, /<m:rad><m:radPr><m:degHide m:val="1"\/><\/m:radPr><m:deg\/><m:e>.*x.*<\/m:e><\/m:rad>/);
  assert.match(o, /<m:rad><m:deg>.*3.*<\/m:deg><m:e>.*y.*<\/m:e><\/m:rad>/);
  assert.match(o, /<m:rPr><m:sty m:val="p"\/><\/m:rPr><m:t xml:space="preserve">sin<\/m:t>/);
  assert.match(o, /<m:acc><m:accPr><m:chr m:val="̂"\/><\/m:accPr><m:e>.*x.*<\/m:e><\/m:acc>/);
});

test('\\sum_{i=1}^n x_i and \\int_0^1 f(x)dx: big operators take the rest of the row', () => {
  const sum = O.fromMathml(M('<munderover><mo data-mjx-texclass="OP">∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msub><mi>x</mi><mi>i</mi></msub>', true));
  assert.match(sum, /^<m:oMath><m:nary><m:naryPr><m:chr m:val="∑"\/><m:limLoc m:val="undOvr"\/><\/m:naryPr><m:sub>.*i.*=.*1.*<\/m:sub><m:sup>.*n.*<\/m:sup><m:e><m:sSub>/);
  const int = O.fromMathml(M('<msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo><mi>d</mi><mi>x</mi>'));
  assert.match(int, /<m:nary><m:naryPr><m:chr m:val="∫"\/><m:limLoc m:val="subSup"\/><\/m:naryPr><m:sub>.*0.*<\/m:sub><m:sup>.*1.*<\/m:sup><m:e>.*f.*\(.*x.*\).*d.*x.*<\/m:e><\/m:nary><\/m:oMath>$/);
});

test('matrices and aligned rows become a Word matrix; entities are read; the unknown falls back', () => {
  const o = O.fromMathml(M('<mrow><mo>(</mo><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr><mtr><mtd><mn>0</mn></mtd><mtd><mn>1</mn></mtd></mtr></mtable><mo>)</mo></mrow>'));
  assert.match(o, /<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="2"\/>/);
  assert.equal((o.match(/<m:mr>/g) || []).length, 2);
  assert.match(O.fromMathml(M('<mi>&#x3B1;</mi><mo>&lt;</mo><mi>&#x3B2;</mi>')), /α<\/m:t>.*&lt;<\/m:t>.*β<\/m:t>/);
  assert.equal(O.fromMathml(M('<mglyph src="x"/>')), null, 'an element it doesn’t know: null, and Word gets a picture');
  assert.equal(O.fromMathml('not maths'), null);
});
