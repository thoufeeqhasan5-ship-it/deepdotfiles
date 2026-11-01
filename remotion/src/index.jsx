import React from 'react';
import {Composition, registerRoot, continueRender, delayRender, staticFile} from 'remotion';
import {Story} from './Story';

// brand font (Archivo Black), bundled with the service
const fontHandle = delayRender('Loading font');
const font = new FontFace('Archivo Black', `url('${staticFile('ArchivoBlack-Regular.ttf')}') format('truetype')`);
font.load()
  .then((f) => { document.fonts.add(f); continueRender(fontHandle); })
  .catch((err) => { console.log('Font failed to load, using fallback', err); continueRender(fontHandle); });

const sample = {
  k: 0, title: 'Something strange is hiding in deep space', area: 'space', brand: 'Deep Dot Files',
  duration: 22, voiceEnd: 22.3, end: 24.5, segDur: [5, 9, 10.5],
  words: [{w: 'Something', s: 0.2, e: 0.7, c: 0, seg: 0}, {w: 'strange', s: 0.7, e: 1.2, c: 0, seg: 0}],
  media: {},
};

const Root = () => (
  <Composition
    id="Story"
    component={Story}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={735}
    defaultProps={sample}
    calculateMetadata={({props}) => ({durationInFrames: Math.max(60, Math.ceil(Number(props.end || 24) * 30))})}
  />
);

registerRoot(Root);
