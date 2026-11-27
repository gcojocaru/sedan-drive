// Sample along the axles of a car pointing along local +x. Across a grid
// boundary the wheelbase averages the grades under the front and rear tyres.
export function roadGrade(height, x, z, heading) {
  const dx = 1.315 * Math.cos(heading), dz = -1.315 * Math.sin(heading);
  return (height(x + dx, z + dz) - height(x - dx, z - dz)) / 2.63;
}

export function groundPose(height, x, z, heading) {
  const dx = 0.77 * Math.sin(heading), dz = 0.77 * Math.cos(heading);
  const roll = -Math.atan((height(x + dx, z + dz) - height(x - dx, z - dz)) / 1.54);
  const pitch = Math.atan(roadGrade(height, x, z, heading) * Math.cos(roll));
  return { y: height(x, z), roll, pitch };
}
