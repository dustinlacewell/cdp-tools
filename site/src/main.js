// Project a sampled height field into the tilted browser viewport.
const ctx = document.querySelector("canvas").getContext("2d");
ctx.setTransform(1, -.15, .42, .88, 76, 117);
const w = 524, h = 294;
function panel(y, fill, ink) {
  ctx.fillStyle = fill; ctx.strokeStyle = ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(0, y, w, h, 7); ctx.fill(); ctx.stroke();
}
panel(62, "#628b72", "#385b4b"); panel(43,"#b3cdaa","#486c57"); panel(24,"#e7f1d6","#486c57"); panel(0,"#103e35","#294e42");
ctx.fillStyle = "#e5efd6"; ctx.fillRect(2,2,w-4,34);
for(let i=0;i<3;i++){ctx.fillStyle=["#49775d","#9fb999","#bdceb1"][i];ctx.beginPath();ctx.arc(17+i*14,18,4,0,Math.PI*2);ctx.fill();}
ctx.fillStyle="#53745f";ctx.font="12px monospace";ctx.fillText("cdp / renderer",w-122,22);
ctx.save();ctx.beginPath();ctx.rect(2,37,w-4,h-39);ctx.clip();
function surface(x,y){
  const ridge= Math.exp(-(((x-.54)/.23)**2+((y-.57)/.40)**2))*96;
  const wave= Math.sin(13*x+3*y)*Math.exp(-((x-.5)**2)*6)*19;
  return [24+x*477,104+y*163-ridge-wave];
}
for(let row=0;row<=32;row++){
  ctx.beginPath();for(let col=0;col<=75;col++){const [x,y]=surface(col/75,row/32);if(!col)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
  ctx.strokeStyle=row%4===0?"#d3fa91":"#82be79";ctx.lineWidth=row%4===0?1.7:.85;ctx.stroke();
}
for(let col=0;col<=36;col++){
  ctx.beginPath();for(let row=0;row<=32;row++){const [x,y]=surface(col/36,row/32);if(!row)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
  ctx.strokeStyle="#7dbb78";ctx.lineWidth=.7;ctx.stroke();
}
ctx.restore();
