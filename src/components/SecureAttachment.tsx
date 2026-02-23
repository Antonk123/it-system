/**
 * Secure attachment components
 *
 * These components handle file downloads that require authentication.
 * Since browsers don't send Authorization headers with <img> or <a> tags,
 * we fetch files using the fetch API and create blob URLs.
 */

import { useEffect, useState } from 'react';
import { getAuthenticatedFileUrl, downloadAuthenticatedFile } from '@/lib/secureFileAccess';
import { Loader2 } from 'lucide-react';

interface SecureImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fileId: string;
}

/**
 * Image component that loads images with authentication
 */
export const SecureImage = ({ fileId, alt, className, ...props }: SecureImageProps) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(false);
        const url = await getAuthenticatedFileUrl(fileId);
        if (mounted) {
          setBlobUrl(url);
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to load image:', err);
        if (mounted) {
          setError(true);
          setLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      mounted = false;
    };
  }, [fileId]);

  if (loading) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f0f0' }}>
        <span style={{ fontSize: '10px' }}>❌</span>
      </div>
    );
  }

  return <img src={blobUrl} alt={alt} className={className} {...props} />;
};

interface SecureDownloadLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  fileId: string;
  filename: string;
}

/**
 * Download link that downloads files with authentication
 */
export const SecureDownloadLink = ({ fileId, filename, children, className, ...props }: SecureDownloadLinkProps) => {
  const [downloading, setDownloading] = useState(false);

  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();

    if (downloading) return;

    try {
      setDownloading(true);
      await downloadAuthenticatedFile(fileId, filename);
    } catch (error) {
      console.error('Failed to download file:', error);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <a
      href="#"
      onClick={handleClick}
      className={className}
      style={{ cursor: downloading ? 'wait' : 'pointer' }}
      {...props}
    >
      {downloading ? (
        <>
          <Loader2 className="inline w-3 h-3 animate-spin mr-1" />
          {children}
        </>
      ) : (
        children
      )}
    </a>
  );
};
