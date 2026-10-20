import React from 'react'
import Anomaly from '../visualizers/Anomaly'
import Lightning from '../visualizers/Lightning'
import MilkDrop from '../visualizers/MilkDrop'
import Spectrum from '../visualizers/Spectrum'
import Waves from '../visualizers/Waves'

export default function VisualizerCanvas({ visualizer = 'milkdrop', currentTrack = null, isPlaying = false, className = 'absolute inset-0 h-full w-full' }) {
  switch (visualizer) {
    case 'anomaly':
      return <Anomaly sensitivity={5} size={1.65} color="accent" className={className} />
    case 'spectrum':
      return <Spectrum isPlaying={isPlaying} bars={240} barWidth={3} height={540} strength={1.1} color="accent" opacity={0.95} radius={2} fill className={className} />
    case 'waves':
      return <Waves isPlaying={isPlaying} width={1920} height={860} strength={1.2} colorBack="accent" colorFront="#ffffff" opacity={0.9} fill className={className} />
    case 'lightning':
      return <Lightning isPlaying={isPlaying} strength={1.15} opacity={0.95} className={className} />
    case 'milkdrop':
    default:
      return <MilkDrop className={className} isPlaying={isPlaying} trackId={currentTrack?.id} />
  }
}
