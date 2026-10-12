export function roomLabelPoint(outline: number[][], holes: number[][][]): number[] {
  const rings = [outline, ...holes], ys = [...new Set(rings.flat().map(p => p[1]))].sort((a,b) => a-b);
  let best = outline[0] || [0,0], width = -1;
  for (let i=1;i<ys.length;i++) {
    const y = (ys[i-1]+ys[i])/2, xs: number[] = [];
    for (const ring of rings) ring.forEach((a,j) => {
      const b = ring[(j+1)%ring.length];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
    });
    xs.sort((a,b)=>a-b);
    for(let j=0;j+1<xs.length;j+=2) if(xs[j+1]-xs[j]>width) {width=xs[j+1]-xs[j];best=[(xs[j]+xs[j+1])/2,y];}
  }
  return [...best, Math.max(0, width)];
}
