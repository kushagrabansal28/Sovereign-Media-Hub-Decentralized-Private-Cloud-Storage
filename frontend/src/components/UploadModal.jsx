import React, { useState } from 'react';
import { useNostr } from '../hooks/useNostr';
import { uploadBlob } from '../services/api';
import { compressImage, isSupportedMedia, formatFileSize } from '../services/compress';
import { generateBlurhash, getImageDimensions } from '../services/blurhash';

export default function UploadModal({ onUploadSuccess, onCancel }) {
  const { getBlossomNIP98Token, pubkey } = useNostr();
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, processing, uploading, success, error
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  
  // File metadata computed client-side
  const [metadata, setMetadata] = useState(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = async (rawFile) => {
    if (!isSupportedMedia(rawFile)) {
      setErrorMsg(`Unsupported file type: ${rawFile.type}`);
      return;
    }
    
    setFile(rawFile);
    setStatus('processing');
    setErrorMsg('');
    setProgress(10);
    
    try {
      // 1. Compress Image (if applicable)
      const compressedFile = await compressImage(rawFile, (p) => setProgress(10 + Math.floor(p * 0.4)));
      setProgress(50);
      
      const isImg = compressedFile.type.startsWith('image/');
      
      let blurhash = null;
      let dim = null;
      
      if (isImg && compressedFile.type !== 'image/gif') {
        // 2. Compute Blurhash
        try {
           blurhash = await generateBlurhash(compressedFile);
        } catch (e) {
           console.warn("Failed to generate blurhash", e);
        }
        // 3. Get dimensions for tag
        try {
           const { width, height } = await getImageDimensions(compressedFile);
           dim = `${width}x${height}`;
        } catch (e) {
            console.warn("Failed to get dimensions", e);
        }
      }
      
      setProgress(100);
      setMetadata({ file: compressedFile, blurhash, dim });
      setStatus('idle'); // ready to upload
      
    } catch (err) {
      setStatus('error');
      setErrorMsg('Failed to process file: ' + err.message);
    }
  };

  const handleUploadClick = async () => {
    if (!metadata || !pubkey) return;
    setStatus('uploading');
    setProgress(0);
    
    try {
      // 1. Get auth token
      const token = await getBlossomNIP98Token('/upload', 'PUT');
      
      // 2. Upload to Blossom server
      const response = await uploadBlob(metadata.file, token, (p) => {
        setProgress(p);
      });
      
      setStatus('success');
      
      // 3. Prepare NIP-94 tags
      const tags = [
        ['url', response.url],
        ['x', response.sha256],
        ['m', response.type],
        ['size', String(response.size)]
      ];
      if (metadata.dim) tags.push(['dim', metadata.dim]);
      if (metadata.blurhash) tags.push(['blurhash', metadata.blurhash]);
      // Optional description tag
      tags.push(['alt', `Uploaded via Sovereign Media Hub`]);

      const nip94EventTemplate = {
        kind: 1063,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: `Media uploaded on ${new Date().toLocaleDateString()}`
      };
      
      // 4. Pass back to parent to sign and publish
      setTimeout(() => {
         onUploadSuccess(nip94EventTemplate);
      }, 1000);
      
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2 className="modal-title">Upload Media</h2>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        
        {status === 'success' ? (
           <div className="empty-state">
             <div className="empty-state-icon" style={{ opacity: 1 }}>🎉</div>
             <h3 className="empty-state-title">Upload Complete</h3>
             <p className="empty-state-text">Your file has been successfully uploaded.</p>
           </div>
        ) : !file ? (
          <div>
            <div 
              className={`drop-zone ${dragActive ? 'active' : ''}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="drop-zone-icon">☁️</div>
              <p className="drop-zone-text">
                Drag & Drop your media here, or
              </p>
              <label className="btn btn-secondary" style={{ marginTop: 'var(--space-md)' }}>
                Browse Files
                <input 
                  type="file" 
                  style={{ display: 'none' }} 
                  accept="image/*,video/*"
                  onChange={handleChange}
                />
              </label>
            </div>
          </div>
        ) : (
           <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
             <div className="glass-card" style={{ padding: 'var(--space-md)', display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-elevated)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden'
                }}>
                   {metadata?.file?.type.startsWith('image/') ? (
                     <img src={URL.createObjectURL(metadata.file)} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                   ) : (
                     <span style={{ fontSize: '1.5rem' }}>🎬</span>
                   )}
                </div>
                <div>
                  <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{file.name}</div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                     {metadata?.file ? formatFileSize(metadata.file.size) : formatFileSize(file.size)}
                     {metadata?.file && metadata.file.size < file.size && 
                       <span style={{ color: 'var(--success)', marginLeft: '8px' }}>(Compressed)</span>}
                  </div>
                </div>
             </div>
             
             {status === 'processing' && (
                <div>
                   <p style={{ fontSize: '0.875rem', marginBottom: '8px' }}>Processing media (Compression & Blurhash)...</p>
                   <div className="progress-bar-track">
                      <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                   </div>
                </div>
             )}
             
             {status === 'uploading' && (
                <div>
                   <p style={{ fontSize: '0.875rem', marginBottom: '8px' }}>Uploading to Blossom server...</p>
                   <div className="progress-bar-track">
                      <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                   </div>
                </div>
             )}
             
             {status === 'error' && (
                <div className="toast toast-error" style={{ position: 'static' }}>{errorMsg}</div>
             )}
             
             {status === 'idle' && (
               <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-md)' }}>
                 <button className="btn btn-secondary" onClick={() => setFile(null)}>Cancel</button>
                 <button className="btn btn-primary" onClick={handleUploadClick}>Upload & Publish</button>
               </div>
             )}
             
           </div>
        )}
      </div>
    </div>
  );
}
