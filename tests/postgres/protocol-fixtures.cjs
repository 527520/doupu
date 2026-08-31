/** PostgreSQL/standalone 契约共用的最小严格 v3 测试夹具。 */
function strictV3Project(name = 'protocol-v3') {
  return {
    format: 'doupu-project',
    version: 3,
    engineVersion: '2.0.0',
    boardProfile: '5mm-29',
    name,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    paletteSelection: { palette: { kind: 'builtin', brand: 'MARD' }, kitTier: 0 },
    params: {
      targetWidth: 20,
      targetColorCount: 2,
      dithering: false,
      mode: 'dominant',
      brightness: 0,
      contrast: 0,
      backgroundRemoval: false,
      bgTolerance: 8,
    },
    pattern: {
      width: 1,
      height: 1,
      cells: [{ hex: '#000000', code: 'H07', transparent: false }],
    },
  };
}

function strictV3Share(project = strictV3Project(), name = 'protocol-v3-share') {
  return {
    version: 3,
    name,
    createdAt: project.createdAt,
    boardProfile: project.boardProfile,
    palette: project.paletteSelection.palette,
    pattern: project.pattern,
  };
}

module.exports = { strictV3Project, strictV3Share };
