import React, { useState, useEffect, useRef } from 'react';
import { decodeBlurhashToDataURL } from '../services/blurhash';
import { formatFileSize } from '../services/compress';

export default function MediaCard({ nip94Event, onClick }) {
  const [inView, setInView] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef(null);
  
  // Extract NIP-94 tags
  const tags = nip94Event.tags || [];
  const getTag = (name) => {
    const t = tags.find(tag => tag[0] === name);
    return t ? t[1] : null;
  };

  const url = getTag('url');
  const blurhash = getTag('blurhash');
  const mimeType = getTag('m');
  const size = getTag('size');
  
  const isVideo = mimeType && mimeType.startsWith('video/');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' } // Load slightly before it comes into view
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const placeholderDataUrl = blurhash ? decodeBlurhashToDataURL(blurhash, 32, 32) : null;
  const showPlaceholder = placeholderDataUrl && !loaded;

  return (
    <div 
      className="glass-card animate-fade-in-scale" 
      onClick={onClick}
      style={{ 
        position: 'relative', 
        overflow: 'hidden', 
        cursor: 'pointer',
        aspectRatio: '3/4', // Default aspect ratio, or could parse 'dim' tag
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-tertiary)'
      }}
    >
      {/* Blurhash Placeholder */}
      {showPlaceholder && (
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${placeholderDataUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(10px)',
          transform: 'scale(1.1)', // hide blurred edges
          zIndex: 1
        }} />
      )}

      {/* Actual Image / Video */}
      {inView && url && (
        isVideo ? (
          <video 
            ref={imgRef}
            src={url}
            muted
            loop
            onLoadedData={() => setLoaded(true)}
            onMouseEnter={e => e.target.play()}
            onMouseLeave={e => e.target.pause()}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              position: 'relative',
              zIndex: 2,
              opacity: loaded ? 1 : 0,
              transition: 'opacity var(--transition-normal)'
            }}
          />
        ) : (
          <img 
            ref={imgRef}
            src={url} 
            alt="Media" 
            onLoad={() => setLoaded(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              position: 'relative',
              zIndex: 2,
              opacity: loaded ? 1 : 0,
              transition: 'opacity var(--transition-normal)'
            }}
          />
        )
      )}

      {/* Video Indicator */}
      {isVideo && (
        <div style={{
          position: 'absolute',
          top: 'var(--space-sm)',
          right: 'var(--space-sm)',
          zIndex: 3,
          background: 'rgba(0,0,0,0.5)',
          padding: '4px',
          borderRadius: 'var(--radius-full)'
        }}>
          ▶️
        </div>
      )}

      {/* Hover Overlay */}
      <div 
        className="media-overlay"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 50%)',
          zIndex: 3,
          opacity: 0,
          transition: 'opacity var(--transition-fast)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: 'var(--space-sm)'
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = 1}
        onMouseLeave={e => e.currentTarget.style.opacity = 0}
      >
         {size && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{formatFileSize(size)}</span>}
      </div>
    </div>
  );
}
