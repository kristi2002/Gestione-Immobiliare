// Settings page — pure HTML-string builders. Stateless.
//
// This controller builds every HTML fragment inline inside DOM-touching
// functions (loadUsers, loadEmailTemplates, loadReadiness), reading module
// state and page DOM as it goes. None of them is a standalone pure
// data -> string builder, so extracting one would require inventing a new
// function (a logic change), which this behavior-preserving refactor forbids.
// Nothing qualified for extraction here; kept intentionally empty.

export {};
