export default function CaseLoading() {
  return (
    <main className="page" aria-busy="true" aria-label="Loading case details">
      <span className="back-link skeleton skeleton-text" style={{ width: "8rem" }} />

      <span
        className="skeleton skeleton-text"
        style={{ width: "4rem", height: "1.4rem", marginTop: "1rem" }}
      />
      <div className="skeleton skeleton-text skeleton-title" />

      <dl className="case-facts">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>
            <dt className="skeleton skeleton-text" style={{ width: "5rem" }} />
            <dd className="skeleton skeleton-text" style={{ width: "9rem" }} />
          </div>
        ))}
      </dl>

      <div className="skeleton skeleton-text" style={{ width: "14rem", marginTop: "1.5rem" }} />

      <div className="skeleton skeleton-text skeleton-heading" />
      <ul className="entries">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="entry">
            <div className="entry-header">
              <span className="skeleton skeleton-text" style={{ width: "3rem" }} />
              <span className="skeleton skeleton-text" style={{ width: "6rem" }} />
            </div>
            <div className="skeleton skeleton-text" style={{ width: "100%" }} />
            <div className="skeleton skeleton-text" style={{ width: "70%" }} />
          </li>
        ))}
      </ul>
    </main>
  );
}
