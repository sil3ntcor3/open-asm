package worker

import (
	"testing"

	"github.com/go-rod/rod/lib/launcher/flags"
)

// ignoreCertErrorsFlag is the chromium switch that lets the headless browser
// screenshot web services whose TLS certificate is self-signed or has a
// mismatched common name (common in ASM), instead of aborting navigation with
// net::ERR_CERT_COMMON_NAME_INVALID.
const ignoreCertErrorsFlag = flags.Flag("ignore-certificate-errors")

func TestNewBrowserLauncherIgnoresCertErrors(t *testing.T) {
	l := newBrowserLauncher("")
	if !l.Has(ignoreCertErrorsFlag) {
		t.Fatalf("expected launcher to set %q so cert-broken web services still screenshot", ignoreCertErrorsFlag)
	}
}

func TestNewBrowserLauncherIsHeadless(t *testing.T) {
	l := newBrowserLauncher("")
	if !l.Has(flags.Headless) {
		t.Fatalf("expected launcher to run headless")
	}
}

func TestNewBrowserLauncherPinsNoBinWhenPathEmpty(t *testing.T) {
	l := newBrowserLauncher("")
	if got := l.Get(flags.Bin); got != "" {
		t.Fatalf("expected no explicit browser binary pinned when path is empty (let rod resolve), got %q", got)
	}
}

func TestNewBrowserLauncherSetsBinWhenPathGiven(t *testing.T) {
	const path = "/usr/bin/chromium"
	l := newBrowserLauncher(path)
	if got := l.Get(flags.Bin); got != path {
		t.Fatalf("expected bin flag %q, got %q", path, got)
	}
}
