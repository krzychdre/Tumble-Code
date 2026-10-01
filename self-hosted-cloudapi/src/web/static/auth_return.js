/*
 * The sign-in success page (templates/auth_success.html) hands the browser
 * back to the editor by following its own "Return to VS Code" link. The URL
 * is read from the link's href attribute, where autoescape put it, so it is
 * never written into a script. Some browsers ignore a navigation to a custom
 * scheme (vscode://); the link then stays on the page to click.
 */
;(function () {
	"use strict"

	var link = document.getElementById("return-link")
	var url = link && link.getAttribute("href")
	if (!url) return
	try {
		window.location.assign(url)
	} catch (e) {
		// The reader clicks the link instead.
	}
})()
