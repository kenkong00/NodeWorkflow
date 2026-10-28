import io
p = '.tools/accept-final.mjs'
s = io.open(p, encoding='utf-8').read()

s = s.replace("""  console.log('add TextDisplay:', await ev(`window.__T.addBySearch(420, 560, '文本显示')`));
  const r1 = await ev(`window.__T.dragOutToBlank(window.__T.lastOf('TextInput'), 700, 700, '文本显示')`);
  console.log('link rows:', r1);""",
"""  const r1 = await ev(`window.__T.dragOutToBlank(window.__T.lastOf('TextInput'), 700, 700, '文本显示')`);
  console.log('link rows:', r1);""")

s = s.replace("""  console.log('link P1→MathOp rows:', await ev(`window.__T.dragOutToBlank(window.__T.byType('PrimitiveFloat')[0], 700, 880, '数学运算')`));
  console.log('link P2→MathOp rows:', await ev(`window.__T.dragOutToBlank(window.__T.byType('PrimitiveFloat')[1], 700, 930, '数学运算')`));""",
"""  console.log('link P1→MathOp:', await ev(`window.__T.dragOntoNode(window.__T.byType('PrimitiveFloat')[0], window.__T.lastOf('MathOp'))`));
  console.log('link P2→MathOp:', await ev(`window.__T.dragOntoNode(window.__T.byType('PrimitiveFloat')[1], window.__T.lastOf('MathOp'))`));""")

s = s.replace("""  console.log('add Preview:', await ev(`window.__T.addBySearch(1350, 560, '预览图像')`));
  console.log('link rows:', await ev(`window.__T.dragOutToBlank(window.__T.lastOf('LoadImageNative'), 1500, 800, '预览图像')`));""",
"""  console.log('link rows:', await ev(`window.__T.dragOutToBlank(window.__T.lastOf('LoadImageNative'), 1500, 800, '预览图像')`));""")

s = s.replace("""    nodes: () => Object.values(window.__comfyGraph.graph._nodes),""",
"""    async dragOntoNode(srcNode, dstNode) {
      const p = this.portScreen(srcNode);
      const g = window.__comfyGraph;
      const rect = g.canvas.canvas.getBoundingClientRect();
      const va = g.canvas.visible_area;
      const dx = Math.round(rect.left + (dstNode.pos[0] + dstNode.size[0] / 2 - va[0]) * g.canvas.ds.scale);
      const dy = Math.round(rect.top + (dstNode.pos[1] + dstNode.size[1] / 2 - va[1]) * g.canvas.ds.scale);
      const c = g.canvas.canvas;
      const mk = (type, x, y, buttons) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons, bubbles: true, cancelable: true, view: window }));
      mk('mousedown', p.x, p.y, 1);
      mk('mousemove', dx, dy, 1);
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: dx, clientY: dy, button: 0, buttons: 0, bubbles: true, cancelable: true, view: window }));
      await new Promise(r => setTimeout(r, 400));
      return 'links=' + Object.keys(g.graph.links || {}).length;
    },
    nodes: () => Object.values(window.__comfyGraph.graph._nodes),""")

s = s.replace("""  console.log('== G. 真实执行 ==');
  await ev(`document.querySelector('.topbar button.primary').click()`);""",
"""  console.log('== G. 真实执行 ==');
  await ev(`window.__prompts = []; const of = window.fetch; window.fetch = async function (...a) { const r = await of.apply(this, a); if (String(a[0]).includes('/prompt')) { const c = r.clone(); try { window.__prompts.push({ url: String(a[0]), body: await r.text() }); } catch (e) {} } return r; };`);
  await ev(`document.querySelector('.topbar button.primary').click()`);""")

s = s.replace("""  console.log('exec btn back:'""",
"""  console.log('prompt resp:', await ev('JSON.stringify(window.__prompts)'));
  console.log('exec btn back:'""")

io.open(p, 'w', encoding='utf-8').write(s)
print('patched2-ok')
