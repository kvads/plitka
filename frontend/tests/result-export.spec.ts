import { expect, test } from "@playwright/test";
import { partDimensionSvg } from "../src/domain/project/result-export";

test("SVG adds both dimensions of an L-shaped door-reveal cut", () => {
  const svg = partDimensionSvg([
    [0, 0], [450, 0], [450, 600], [20, 600], [20, 490], [0, 490],
  ]);

  expect(svg.match(/data-part-dimension/g)).toHaveLength(6);
  expect(svg).toContain(">450 мм</text>");
  expect(svg).toContain(">600 мм</text>");
  expect(svg).toContain(">110 мм</text>");
  expect(svg).toContain(">20 мм</text>");
  expect(svg).toContain(">490 мм</text>");
});

test("SVG rounds manufacturing edges half-up without moving their coordinates", () => {
  const ring = [[0, 0], [556.6, 0], [556.6, 400.4], [100, 400.4], [100, 200], [0, 200]];
  const svg = partDimensionSvg(ring);

  expect(svg).toContain('x2="556.6"');
  expect(svg).toContain(">557 мм</text>");
  expect(svg).toContain(">400 мм</text>");
  expect(svg).not.toMatch(/>\d+[,.]\d+ мм<\/text>/);
});

test("SVG dimensions include shower-plane height difference", () => {
  const svg = partDimensionSvg([[0, 0], [1000, 0], [1000, 100], [100, 100], [100, 50], [0, 50]],
    point => point[0] * .05);
  expect(svg).toContain(">1001 мм</text>");
});
