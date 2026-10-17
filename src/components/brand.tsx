import Link from "next/link";
export function Brand() {
  return <Link href="/" className="brand" aria-label="Waypoint home"><span className="brand-symbol" aria-hidden="true"><i /><i /><i /></span>waypoint<span className="brand-dot">®</span></Link>;
}
