import React from "react";

type ImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string | { src: string };
  alt: string;
};

function resolveSrc(src: ImageProps["src"]): string {
  if (typeof src === "string") return src;
  if (src && typeof src === "object" && typeof src.src === "string") return src.src;
  return "";
}

export default function Image({ src, alt, ...rest }: ImageProps) {
  return <img src={resolveSrc(src)} alt={alt} {...rest} />;
}
