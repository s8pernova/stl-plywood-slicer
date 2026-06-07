attribute vec3 aPos;
uniform float uRotX;
uniform float uRotY;
uniform float uZoom;

void main() {
  vec3 p = aPos;

  float cy = cos(uRotY);
  float sy = sin(uRotY);
  p = vec3(
    p.x * cy + p.z * sy,
    p.y,
   -p.x * sy + p.z * cy
  );

  float cx = cos(uRotX);
  float sx = sin(uRotX);
  p = vec3(
    p.x,
    p.y * cx - p.z * sx,
    p.y * sx + p.z * cx
  );

  float ay = radians(45.0);
  float ax = radians(35.264);
  p = vec3(
    p.x * cos(ay) + p.z * sin(ay),
    p.y,
   -p.x * sin(ay) + p.z * cos(ay)
  );
  p = vec3(
    p.x,
    p.y * cos(ax) - p.z * sin(ax),
    p.y * sin(ax) + p.z * cos(ax)
  );

  p *= uZoom;
  gl_Position = vec4(
    p.xy,
    -p.z * 0.001,
    1.0
  );
}
