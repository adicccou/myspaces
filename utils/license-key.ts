export async function checkLicenseKey(licenseKey: string): Promise<boolean> {
  const activatedRes = await fetch(
    "https://api-cors-anywhere.lemonsqueezy.com/v1/licenses/activate",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.WXT_LEMONSQUEEZY_API_KEY}`,
      },
      body: JSON.stringify({
        license_key: licenseKey,
        instance_name: "Test",
      }),
    }
  );

  const activatedResData = await activatedRes.json();
  const activated = activatedResData.activated;
  if (activated) return true;

  const validateRes = await fetch(
    "https://api-cors-anywhere.lemonsqueezy.com/v1/licenses/validate",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.WXT_LEMONSQUEEZY_API_KEY}`,
      },
      body: JSON.stringify({
        license_key: licenseKey,
      }),
    }
  );

  const validateResData = await validateRes.json();
  return !!(validateResData.license_key?.status === "active");
}
